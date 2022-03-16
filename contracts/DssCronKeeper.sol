// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../vendor/dss-cron/src/interfaces/IJob.sol";
import "./DssVestTopUp.sol";

interface SequencerLike {
    function numJobs() external view returns (uint256);

    function jobAt(uint256 index) external view returns (address);
}

contract DssCronKeeper is KeeperCompatibleInterface, Ownable {
    SequencerLike public immutable sequencer;
    DssVestTopUp public topUp;
    bytes32 public network;

    constructor(address _sequencer, bytes32 _network) {
        sequencer = SequencerLike(_sequencer);
        network = _network;
    }

    function checkUpkeep(bytes calldata)
        external
        override
        returns (bool, bytes memory)
    {
        if (address(topUp) != address(0) && topUp.checker()) {
            return (true, abi.encodeWithSelector(this.performTopUp.selector));
        }
        (address job, bytes memory args) = getWorkableJob();
        if (job != address(0)) {
            return (true, abi.encodeWithSelector(this.performJob.selector, job, args));
        }
        return (false, "");
    }

    function performUpkeep(bytes calldata performData) external override {
        (bool success, ) = address(this).delegatecall(performData);
        require(success, "failed to perform upkeep");
    }

    function performJob(address job, bytes memory args) public {
        IJob(job).work(network, args);
    }

    function performTopUp() public {
        topUp.topUp();
    }

    function getWorkableJob() internal returns (address, bytes memory) {
        for (uint256 i = 0; i < sequencer.numJobs(); i++) {
            address job = sequencer.jobAt(i);
            (bool canWork, bytes memory args) = IJob(job).workable(network);
            if (canWork) return (job, args);
        }
        return (address(0), "");
    }

    function setTopUp(address _topUp) external onlyOwner {
        topUp = DssVestTopUp(_topUp);
    }
}
