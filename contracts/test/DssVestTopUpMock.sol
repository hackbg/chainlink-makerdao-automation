// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

contract DssVestTopUpMock {
    bool private checkerState;

    event TopUp();

    constructor() {
        checkerState = false;
    }

    function run() public {
        emit TopUp();
    }

    function check() public view returns (bool) {
        return checkerState;
    }

    function setChecker(bool state) public {
        checkerState = state;
    }
}
