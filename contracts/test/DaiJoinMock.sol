// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ERC20Like {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external;
}

contract DaiJoinMock {
    ERC20Like public dai;

    constructor(address _dai) {
        dai = ERC20Like(_dai);
    }

    function join(address usr, uint256 wad) external {
        dai.transferFrom(msg.sender, usr, wad);
    }
}
