// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

interface ITopUp {
    function run() external;

    function check() external view returns (bool);
}
