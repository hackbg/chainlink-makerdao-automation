// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "./interfaces/ITopUp.sol";

interface DssVestLike {
    function vest(uint256 _id) external;

    function unpaid(uint256 _id) external view returns (uint256 amt);
}

interface DaiJoinLike {
    function join(address usr, uint256 wad) external;
}

interface KeeperRegistryLike {
    function getUpkeep(uint256 id)
        external
        view
        returns (
            address target,
            uint32 executeGas,
            bytes memory checkData,
            uint96 balance,
            address lastKeeper,
            address admin,
            uint64 maxValidBlocknumber
        );

    function addFunds(uint256 id, uint96 amount) external;

    function getMinBalanceForUpkeep(uint256 id)
        external
        view
        returns (uint96 minBalance);
}

/// @title DssVestTopUp
/// @notice Replenishes a Chainlink upkeep balance on demand
/// @dev Withdraws vested tokens or uses transferred tokens from Maker's protocol and
/// funds an upkeep after swapping the payment tokens for LINK
contract DssVestTopUp is ITopUp, Ownable {
    uint24 public constant UNISWAP_POOL_FEE = 3000;

    DssVestLike public immutable dssVest;
    DaiJoinLike public immutable daiJoin;
    KeeperRegistryLike public immutable keeperRegistry;
    ISwapRouter public immutable swapRouter;
    address public immutable vow;
    address public immutable paymentToken;
    address public immutable linkToken;
    uint256 public vestId;
    uint256 public upkeepId;
    uint256 public minWithdrawAmt;
    uint256 public maxDepositAmt;
    uint256 public minBalancePremium;

    constructor(
        address _dssVest,
        address _daiJoin,
        address _vow,
        address _paymentToken,
        address _keeperRegistry,
        address _swapRouter,
        address _linkToken,
        uint256 _minWithdrawAmt,
        uint256 _maxDepositAmt,
        uint256 _minBalancePremium
    ) {
        dssVest = DssVestLike(_dssVest);
        daiJoin = DaiJoinLike(_daiJoin);
        vow = _vow;
        paymentToken = _paymentToken;
        keeperRegistry = KeeperRegistryLike(_keeperRegistry);
        swapRouter = ISwapRouter(_swapRouter);
        linkToken = _linkToken;
        setMinWithdrawAmt(_minWithdrawAmt);
        setMaxDepositAmt(_maxDepositAmt);
        setMinBalancePremium(_minBalancePremium);
    }

    modifier initialized() {
        require(vestId != 0, "vestId not set");
        require(upkeepId != 0, "upkeepId not set");
        _;
    }

    /// @notice Tops up upkeep balance with LINK
    /// @dev Called by the DssCronKeeper contract when check returns true
    function run() public initialized {
        uint256 amt;
        uint256 preBalance = getPaymentBalance();
        if (preBalance > 0) {
            // Emergency topup
            amt = preBalance;
        } else {
            // Withdraw vested tokens
            dssVest.vest(vestId);
            amt = getPaymentBalance();
            if (amt > maxDepositAmt) {
                // Return excess amount to surplus buffer
                daiJoin.join(vow, amt - maxDepositAmt);
                amt = maxDepositAmt;
            }
        }
        // Swap payment token amount for LINK
        TransferHelper.safeApprove(paymentToken, address(swapRouter), amt);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: paymentToken,
                tokenOut: linkToken,
                fee: UNISWAP_POOL_FEE,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amt,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });
        uint256 amountOut = swapRouter.exactInputSingle(params);
        // Fund upkeep
        TransferHelper.safeApprove(
            linkToken,
            address(keeperRegistry),
            amountOut
        );
        keeperRegistry.addFunds(upkeepId, uint96(amountOut));
    }

    /// @notice Checks whether top up is needed
    /// @dev Called by the upkeep
    /// @return result indicating if topping up the upkeep balance is needed and
    /// if there's enough unpaid vested tokens or tokens in the contract balance
    function check() public view initialized returns (bool) {
        (, , , uint96 balance, , , ) = keeperRegistry.getUpkeep(upkeepId);
        if (
            getUpkeepThreshold() < balance ||
            (dssVest.unpaid(vestId) < minWithdrawAmt &&
            getPaymentBalance() < minWithdrawAmt)
        ) {
            return false;
        }
        return true;
    }

    /// @notice Retrieves the vest payment token balance of this contract
    /// @return balance
    function getPaymentBalance() public view returns (uint256) {
        return IERC20(paymentToken).balanceOf(address(this));
    }

    /// @notice Calculates the minimum balance required to keep the upkeep active
    /// @dev Adds a premium on top of the minimum balance to prevent upkeep from going inactive
    /// @return threshold for triggering top up
    function getUpkeepThreshold() public view returns (uint256) {
        uint256 minBalance = keeperRegistry.getMinBalanceForUpkeep(upkeepId);
        uint256 premium = (minBalance * minBalancePremium) / 100;
        return minBalance + premium;
    }

    // ------------------------
    // Admin functions
    // ------------------------
    function setVestId(uint256 _vestId) external onlyOwner {
        vestId = _vestId;
    }

    function setUpkeepId(uint256 _upkeepId) external onlyOwner {
        upkeepId = _upkeepId;
    }

    function setMinWithdrawAmt(uint256 _minWithdrawAmt) public onlyOwner {
        minWithdrawAmt = _minWithdrawAmt;
    }

    function setMaxDepositAmt(uint256 _maxDepositAmt) public onlyOwner {
        maxDepositAmt = _maxDepositAmt;
    }

    function setMinBalancePremium(uint256 _minBalancePremium) public onlyOwner {
        minBalancePremium = _minBalancePremium;
    }
}
