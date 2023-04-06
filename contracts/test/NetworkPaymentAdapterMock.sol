// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "./ERC20PresetMinterPauser.sol";

contract NetworkPaymentAdapterMock {
    ERC20PresetMinterPauser public paymentToken;
    address public treasury;
    uint256 public topUpAmount;

    constructor(address _daiToken, uint256 _topUpAmount) {
        paymentToken = ERC20PresetMinterPauser(_daiToken);
        topUpAmount = _topUpAmount;
    }

    function setTreasury(address _treasury) external {
        treasury = _treasury;
    }

    function topUp() external returns (uint256 daiSent) {
        paymentToken.mint(treasury, topUpAmount);
        return topUpAmount;
    }

    function canTopUp() external pure returns (bool) {
        return true;
    }
}
