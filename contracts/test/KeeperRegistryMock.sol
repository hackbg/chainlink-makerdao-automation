// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ERC20Like {
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external;
}

contract KeeperRegistryMock {
    ERC20Like public linkToken;
    uint96 private upkeepBalance;

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

    constructor(address _linkToken) {
        linkToken = ERC20Like(_linkToken);
    }

    function getUpkeep(uint256) external view returns (UpkeepInfo memory upkeepInfo) {
        upkeepInfo = UpkeepInfo({
            target: address(0x0),
            executeGas: 0,
            checkData: "",
            balance: upkeepBalance,
            admin: address(0),
            maxValidBlocknumber: 0,
            lastPerformBlockNumber: 0,
            amountSpent: 0,
            paused: false,
            offchainConfig: ""
        });
    }

    function addFunds(uint256, uint96 amount) external {
        linkToken.transferFrom(msg.sender, address(this), amount);
        upkeepBalance += amount;
    }

    function setUpkeepBalance(uint96 balance) external {
        upkeepBalance = balance;
    }
}
