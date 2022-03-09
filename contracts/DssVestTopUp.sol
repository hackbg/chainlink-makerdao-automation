// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";

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
}

contract DssVestTopUp is Ownable {
    uint24 public constant DAI_LINK_POOL_FEE = 3000;

    DssVestLike private immutable dssVest;
    DaiJoinLike private immutable daiJoin;
    KeeperRegistryLike private immutable keeperRegistry;
    ISwapRouter private immutable swapRouter;
    address private immutable vow;
    address private paymentToken;
    address private linkToken;
    uint256 private vestId;
    uint256 private upkeepId;
    uint256 private minWithdrawAmt;
    uint256 private maxDepositAmt;
    uint256 private upkeepThreshold;

    constructor(
        address _dssVest,
        address _daiJoin,
        address _vow,
        address _paymentToken,
        address _keeperRegistry,
        uint256 _upkeepId,
        address _swapRouter,
        address _linkToken,
        uint256 _minWithdrawAmt,
        uint256 _maxDepositAmt,
        uint256 _upkeepThreshold
    ) {
        dssVest = DssVestLike(_dssVest);
        daiJoin = DaiJoinLike(_daiJoin);
        vow = _vow;
        paymentToken = _paymentToken;
        keeperRegistry = KeeperRegistryLike(_keeperRegistry);
        upkeepId = _upkeepId;
        swapRouter = ISwapRouter(_swapRouter);
        linkToken = _linkToken;
        minWithdrawAmt = _minWithdrawAmt;
        maxDepositAmt = _maxDepositAmt;
        upkeepThreshold = _upkeepThreshold;
    }

    function topUp() public {
        uint256 preBalance = IERC20(paymentToken).balanceOf(address(this));
        dssVest.vest(vestId);
        uint256 balance = IERC20(paymentToken).balanceOf(address(this));
        uint256 amt = balance - preBalance;
        // Return excess amount to surplus buffer
        if (amt > maxDepositAmt) {
            daiJoin.join(vow, amt - maxDepositAmt);
            amt = maxDepositAmt;
        }
        // Swap DAI amt for LINK
        TransferHelper.safeApprove(paymentToken, address(swapRouter), amt);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: paymentToken,
                tokenOut: linkToken,
                fee: DAI_LINK_POOL_FEE,
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

    function checker() public view returns (bool) {
        (, , , uint96 balance, , , ) = keeperRegistry.getUpkeep(upkeepId);
        if (balance > upkeepThreshold) {
            return false;
        }
        if (dssVest.unpaid(vestId) < minWithdrawAmt) {
            return false;
        }
        return true;
    }

    function setVestId(uint256 _vestId) external onlyOwner {
        vestId = _vestId;
    }

    function setMinWithdrawAmt(uint256 _minWithdrawAmt) external onlyOwner {
        minWithdrawAmt = _minWithdrawAmt;
    }

    function setMaxDepositAmt(uint256 _maxDepositAmt) external onlyOwner {
        maxDepositAmt = _maxDepositAmt;
    }
}
