// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../vendor/dss-cron/src/interfaces/IJob.sol";
import "./interfaces/IUpkeepRefunder.sol";

interface SequencerLike {
    function numJobs() external view returns (uint256);

    function jobAt(uint256 index) external view returns (address);
}

/**
 * @title DssCronKeeper
 * @notice Checks for Maker protocol cron jobs that need work and runs them.
 * Checks if upkeep funding is needed and executes it.
 */
contract DssCronKeeper is KeeperCompatibleInterface, Ownable {
    SequencerLike public immutable sequencer;
    IUpkeepRefunder public upkeepRefunder;
    bytes32 public network;

    constructor(address _sequencer, bytes32 _network) {
        sequencer = SequencerLike(_sequencer);
        network = _network;
    }

    // ACTIONS

    /**
     * @notice Check whether upkeep needs funding or there is a workable job
     */
    function checkUpkeep(bytes calldata)
        external
        override
        returns (bool, bytes memory)
    {
        if (address(upkeepRefunder) != address(0) && upkeepRefunder.shouldRefundUpkeep()) {
            return (true, abi.encodeWithSelector(this.refundUpkeep.selector));
        }
        (address job, bytes memory args) = getWorkableJob();
        if (job != address(0)) {
            return (true, abi.encodeWithSelector(this.runJob.selector, job, args));
        }
        return (false, "");
    }

    /**
     * @notice Execute contract function with arguments
     * @dev Called by the keeper
     */
    function performUpkeep(bytes calldata performData) external override {
        (bool success, ) = address(this).delegatecall(performData);
        require(success, "failed to perform upkeep");
    }

    /**
     * @notice Execute cron job with params
     * @dev Job work function checks if is still pending and still network turn,
     * otherwise it reverts with an error
     * @param job address
     * @param args to pass to the work function
     */
    function runJob(address job, bytes memory args) public {
        IJob(job).work(network, args);
    }

    /**
     * @notice Call the associated top up contract to fund the upkeep
     */
    function refundUpkeep() public {
        upkeepRefunder.refundUpkeep();
    }

    // GETTERS

    /**
     * @notice Find a job pending to be executed when it's the network's turn
     * @return job address
     * @return args for the job's work function
     */
    function getWorkableJob() internal returns (address, bytes memory) {
        for (uint256 i = 0; i < sequencer.numJobs(); i++) {
            address job = sequencer.jobAt(i);
            (bool canWork, bytes memory args) = IJob(job).workable(network);
            if (canWork) return (job, args);
        }
        return (address(0), "");
    }

    // SETTERS

    function setUpkeepRefunder(address _upkeepRefunder) external onlyOwner {
        upkeepRefunder = IUpkeepRefunder(_upkeepRefunder);
    }
}
