// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "../vendor/dss-cron-standard-payment/src/INetworkTreasury.sol";
import "./interfaces/IUpkeepRefunder.sol";

interface NetworkPaymentAdapterLike {
    function topUp() external returns (uint256 daiSent);

    function canTopUp() external view returns (bool);
}

interface KeeperRegistryLike {
    struct UpkeepInfo {
        address target;
        uint32 executeGas;
        bytes checkData;
        uint96 balance;
        address admin;
        uint64 maxValidBlocknumber;
        uint32 lastPerformBlockNumber;
        uint96 amountSpent;
        bool paused;
        bytes offchainConfig;
    }

    function getUpkeep(uint256) external view returns (UpkeepInfo memory upkeepInfo);

    function addFunds(uint256 id, uint96 amount) external;
}

/**
 * @title DssVestTopUp
 * @notice Replenishes Chainlink upkeep balance on demand from MakerDAO vesting plan.
 * Reports upkeep buffer size convrted in DAI.
 */
contract DssVestTopUp is IUpkeepRefunder, INetworkTreasury, Ownable {
    // DATA
    ISwapRouter public immutable swapRouter;
    address public immutable daiToken;
    address public immutable linkToken;
    address public immutable daiUsdPriceFeed;
    address public immutable linkUsdPriceFeed;
    uint8 public immutable priceFeedDecimals;

    // PARAMS
    uint24 public uniswapPoolFee;
    uint24 public slippageTolerancePercent;
    uint256 public upkeepId;
    NetworkPaymentAdapterLike public paymentAdapter;
    KeeperRegistryLike public keeperRegistry;

    // EVENTS
    event UpkeepRefunded(uint256 amount);
    event SwappedDaiForLink(uint256 amountIn, uint256 amountOut);
    event FundsRecovered(address token, uint256 amount);
    event PaymentAdapterSet(address paymentAdapter);
    event KeeperRegistrySet(address keeperRegistry);
    event UpkeepIdSet(uint256 upkeepId);
    event UniswapPoolFeeSet(uint24 poolFee);
    event SlippageToleranceSet(uint24 slippageTolerancePercent);

    // ERRORS
    error InvalidParam(string name);

    constructor(
        uint256 _upkeepId,
        address _keeperRegistry,
        address _daiToken,
        address _linkToken,
        address _daiUsdPriceFeed,
        address _linkUsdPriceFeed,
        address _swapRouter,
        uint24 _uniswapPoolFee,
        uint24 _slippageTolerancePercent
    ) {
        if (_upkeepId == 0) revert InvalidParam("Upkeep ID");
        if (_keeperRegistry == address(0)) revert InvalidParam("KeeperRegistry");
        if (_daiToken == address(0)) revert InvalidParam("DAI Token");
        if (_linkToken == address(0)) revert InvalidParam("LINK Token");
        if (_daiUsdPriceFeed == address(0)) revert InvalidParam("DAI/USD Price Feed");
        if (_linkUsdPriceFeed == address(0)) revert InvalidParam("LINK/USD Price Feed");
        if (_swapRouter == address(0)) revert InvalidParam("Uniswap Router");

        upkeepId = _upkeepId;
        keeperRegistry = KeeperRegistryLike(_keeperRegistry);
        daiToken = _daiToken;
        linkToken = _linkToken;
        daiUsdPriceFeed = _daiUsdPriceFeed;
        linkUsdPriceFeed = _linkUsdPriceFeed;
        swapRouter = ISwapRouter(_swapRouter);
        uniswapPoolFee = _uniswapPoolFee;
        slippageTolerancePercent = _slippageTolerancePercent;

        // Validate price oracle decimals
        uint8 linkUsdDecimals = AggregatorV3Interface(linkUsdPriceFeed).decimals();
        uint8 daiUsdDecimals = AggregatorV3Interface(daiUsdPriceFeed).decimals();
        if (linkUsdDecimals != daiUsdDecimals) revert InvalidParam("Price oracle");
        priceFeedDecimals = linkUsdDecimals;

        // Allow spending of LINK and DAI tokens
        TransferHelper.safeApprove(daiToken, address(swapRouter), type(uint256).max);
        TransferHelper.safeApprove(linkToken, address(keeperRegistry), type(uint256).max);
    }

    // ACTIONS

    function refundUpkeep() external {
        uint256 daiReceived = paymentAdapter.topUp();
        uint256 linkAmount = _swapDaiForLink(daiReceived);

        keeperRegistry.addFunds(upkeepId, uint96(linkAmount));
        emit UpkeepRefunded(linkAmount);
    }

    // GETTERS

    function shouldRefundUpkeep() external view returns (bool) {
        return paymentAdapter.canTopUp();
    }

    function getBufferSize() external view returns (uint256 daiAmount) {
        uint96 balance = keeperRegistry.getUpkeep(upkeepId).balance;
        daiAmount = _convertLinkToDai(balance);
    }

    // HELPERS

    function _swapDaiForLink(uint256 _daiAmountIn) internal returns (uint256 linkAmountOut) {
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter.ExactInputSingleParams({
            tokenIn: daiToken,
            tokenOut: linkToken,
            fee: uniswapPoolFee,
            recipient: address(this),
            deadline: block.timestamp,
            amountIn: _daiAmountIn,
            amountOutMinimum: _getDaiLinkSwapOutMin(_daiAmountIn),
            sqrtPriceLimitX96: 0
        });
        linkAmountOut = swapRouter.exactInputSingle(params);
        emit SwappedDaiForLink(_daiAmountIn, linkAmountOut);
    }

    function _getDaiLinkSwapOutMin(uint256 _daiAmountIn) internal view returns (uint256 minLinkAmountOut) {
        uint256 linkAmount = _convertDaiToLink(_daiAmountIn);
        uint256 slippageTolerance = (linkAmount * slippageTolerancePercent) / 100;
        minLinkAmountOut = linkAmount - slippageTolerance;
    }

    function _convertLinkToDai(uint256 _linkAmount) internal view returns (uint256 daiAmount) {
        int256 decimals = int256(10**uint256(priceFeedDecimals));
        int256 linkDaiPrice = _getDerivedPrice(linkUsdPriceFeed, daiUsdPriceFeed);
        daiAmount = uint256((int256(_linkAmount) * linkDaiPrice) / decimals);
    }

    function _convertDaiToLink(uint256 _daiAmount) internal view returns (uint256 linkAmount) {
        int256 decimals = int256(10**uint256(priceFeedDecimals));
        int256 daiLinkPrice = _getDerivedPrice(daiUsdPriceFeed, linkUsdPriceFeed);
        linkAmount = uint256((int256(_daiAmount) * daiLinkPrice) / decimals);
    }

    function _getDerivedPrice(address _base, address _quote) internal view returns (int256) {
        int256 decimals = int256(10**uint256(priceFeedDecimals));
        (, int256 basePrice, , , ) = AggregatorV3Interface(_base).latestRoundData();
        (, int256 quotePrice, , , ) = AggregatorV3Interface(_quote).latestRoundData();
        return (basePrice * decimals) / quotePrice;
    }

    // SETTERS

    function setPaymentAdapter(address _paymentAdapter) external onlyOwner {
        if (_paymentAdapter == address(0)) revert InvalidParam("Payment Adapter");
        paymentAdapter = NetworkPaymentAdapterLike(_paymentAdapter);
        emit PaymentAdapterSet(_paymentAdapter);
    }

    function setKeeperRegistry(address _keeperRegistry) external onlyOwner {
        if (_keeperRegistry == address(0)) revert InvalidParam("KeeperRegistry");
        keeperRegistry = KeeperRegistryLike(_keeperRegistry);
        emit KeeperRegistrySet(_keeperRegistry);
    }

    function setUpkeepId(uint256 _upkeepId) external onlyOwner {
        if (_upkeepId == 0) revert InvalidParam("Upkeep ID");
        upkeepId = _upkeepId;
        emit UpkeepIdSet(_upkeepId);
    }

    function setUniswapPoolFee(uint24 _uniswapPoolFee) external onlyOwner {
        uniswapPoolFee = _uniswapPoolFee;
        emit UniswapPoolFeeSet(_uniswapPoolFee);
    }

    function setSlippageTolerance(uint24 _slippageTolerancePercent) external onlyOwner {
        slippageTolerancePercent = _slippageTolerancePercent;
        emit SlippageToleranceSet(_slippageTolerancePercent);
    }

    // MISC

    function recoverFunds(IERC20 _token) external onlyOwner {
        uint256 tokenBalance = _token.balanceOf(address(this));
        _token.transfer(msg.sender, tokenBalance);
        emit FundsRecovered(address(_token), tokenBalance);
    }
}
