// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@uniswap/v3-periphery/contracts/libraries/TransferHelper.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "./interfaces/IUpkeepRefunder.sol";

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

/**
 * @title DssVestTopUp
 * @notice Replenishes upkeep balance on demand
 * @dev Withdraws vested tokens or uses transferred tokens from Maker protocol and
 * funds an upkeep after swapping the payment tokens for LINK
 */
contract DssVestTopUp is IUpkeepRefunder, Ownable {
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
    uint256 public threshold;

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
        uint256 _threshold
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
        setThreshold(_threshold);
    }

    // ACTIONS

    /**
     * @notice Top up upkeep balance with LINK
     * @dev Called by the DssCronKeeper contract when check returns true
     */
    function refundUpkeep() public {
        require(initialized(), "not initialized");
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
        uint256 amtOut = _swapPaymentToLink(amt);
        _fundUpkeep(amtOut);
    }

    /**
     * @notice Check whether top up is needed
     * @dev Called by the keeper
     * @return result indicating if topping up the upkeep balance is needed and
     * if there's enough unpaid vested tokens or tokens in the contract balance
     */
    function shouldRefundUpkeep() public view returns (bool) {
        require(initialized(), "not initialized");
        (, , , uint96 balance, , , ) = keeperRegistry.getUpkeep(upkeepId);
        if (
            threshold < balance ||
            (dssVest.unpaid(vestId) < minWithdrawAmt &&
                getPaymentBalance() < minWithdrawAmt)
        ) {
            return false;
        }
        return true;
    }

    // HELPERS

    function _swapPaymentToLink(uint256 amount)
        internal
        returns (uint256 amountOut)
    {
        TransferHelper.safeApprove(paymentToken, address(swapRouter), amount);
        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: paymentToken,
                tokenOut: linkToken,
                fee: UNISWAP_POOL_FEE,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amount,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            });
        amountOut = swapRouter.exactInputSingle(params);
    }

    function _fundUpkeep(uint256 amount) internal {
        TransferHelper.safeApprove(linkToken, address(keeperRegistry), amount);
        keeperRegistry.addFunds(upkeepId, uint96(amount));
    }

    // GETTERS

    /**
     * @notice Retrieve the vest payment token balance of this contract
     * @return balance
     */
    function getPaymentBalance() public view returns (uint256) {
        return IERC20(paymentToken).balanceOf(address(this));
    }

    function initialized() internal view returns (bool) {
        return vestId != 0 && upkeepId != 0;
    }

    // SETTERS

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

    function setThreshold(uint256 _threshold) public onlyOwner {
        threshold = _threshold;
    }
}
