// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

contract KeeperRegistryMock {
    uint96 private upkeepBalance;

    function getUpkeep(uint256)
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
        )
    {
        return (address(0), 0, "", upkeepBalance, address(0), address(0), 0);
    }

    function addFunds(uint256, uint96 amount) external {
        upkeepBalance += amount;
    }

    function setUpkeepBalance(uint96 balance) external {
        upkeepBalance = balance;
    }
}
