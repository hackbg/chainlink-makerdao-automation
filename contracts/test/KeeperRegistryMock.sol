// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

contract KeeperRegistryMock {
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

    function getUpkeep(uint256)
        external
        view
        returns (UpkeepInfo memory upkeepInfo)
    {
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
        upkeepBalance += amount;
    }

    function setUpkeepBalance(uint96 balance) external {
        upkeepBalance = balance;
    }
}
