// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "../interfaces/IUpkeepRefunder.sol";

contract DssVestTopUpMock is IUpkeepRefunder {
    bool private checkerState;

    event TopUp();

    constructor() {
        checkerState = false;
    }

    function refundUpkeep() public {
        emit TopUp();
    }

    function shouldRefundUpkeep() public view returns (bool) {
        return checkerState;
    }

    function setChecker(bool state) public {
        checkerState = state;
    }

    // solhint-disable-next-line no-empty-blocks
    function setUpkeepId(uint256 _upkeepId) external {}
}
