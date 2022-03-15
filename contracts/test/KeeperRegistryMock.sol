// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

contract KeeperRegistryMock {
    uint96 private upkeepBalance;
    uint96 private minBalance;

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

    function getMinBalanceForUpkeep(uint256) external view returns (uint96) {
        return minBalance;
    }

    function addFunds(uint256, uint96 amount) external {
        upkeepBalance += amount;
    }

    function setUpkeepBalance(uint96 balance) external {
        upkeepBalance = balance;
    }

    function setMinBalance(uint96 min) external {
        minBalance = min;
    }
}
