// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";

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

contract DssCronKeeper is KeeperCompatibleInterface {
    SequencerLike private sequencer;
    bytes32 private network;

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
        returns (bool upkeepNeeded, bytes memory)
    {
        upkeepNeeded = _getPendingJob().job != address(0);
    }

    function performUpkeep(bytes calldata) external override {
        SequencerLike.WorkableJob memory wjob = _getPendingJob();
        if (wjob.job != address(0)) {
            JobLike job = JobLike(wjob.job);
            job.work(network, wjob.args);
        }
    }
}
