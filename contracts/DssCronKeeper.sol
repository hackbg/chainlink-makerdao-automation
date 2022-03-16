// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./DssVestTopUp.sol";

interface SequencerLike {
    struct WorkableJob {
        address job;
        bool canWork;
        bytes args;
    }

    function getNextJobs(bytes32 network)
        external
        returns (WorkableJob[] memory);
}

interface JobLike {
    function work(bytes32 network, bytes calldata args) external;
}

contract DssCronKeeper is KeeperCompatibleInterface, Ownable {
    SequencerLike public immutable sequencer;
    DssVestTopUp public topUp;
    bytes32 public network;

    constructor(address _sequencer, bytes32 _network) {
        sequencer = SequencerLike(_sequencer);
        network = _network;
    }

    function _getPendingJob()
        internal
        returns (SequencerLike.WorkableJob memory)
    {
        SequencerLike.WorkableJob[] memory jobs = sequencer.getNextJobs(
            network
        );
        for (uint256 i = 0; i < jobs.length; i++) {
            SequencerLike.WorkableJob memory job = jobs[i];
            if (job.canWork) {
                return job;
            }
        }
    }

    function checkUpkeep(bytes calldata)
        external
        override
        returns (bool, bytes memory)
    {
        if (address(topUp) != address(0) && topUp.checker() == true) {
            return (true, abi.encodeWithSelector(this.performTopUp.selector));
        }
        SequencerLike.WorkableJob memory wjob = _getPendingJob();
        if (wjob.job != address(0)) {
            return (
                true,
                abi.encodeWithSelector(
                    this.performJob.selector,
                    wjob.job,
                    wjob.args
                )
            );
        }
        return (false, "");
    }

    function performUpkeep(bytes calldata performData) external override {
        (bool success, ) = address(this).delegatecall(performData);
        require(success, "failed to perform upkeep");
    }

    function performJob(address job, bytes memory args) public {
        JobLike(job).work(network, args);
    }

    function performTopUp() public {
        topUp.topUp();
    }

    function setTopUp(address _topUp) external onlyOwner {
        topUp = DssVestTopUp(_topUp);
    }
}
