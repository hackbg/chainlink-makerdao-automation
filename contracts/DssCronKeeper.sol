// SPDX-License-Identifier: MIT
pragma solidity ^0.8.9;

import "@chainlink/contracts/src/v0.8/KeeperCompatible.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../vendor/dss-cron/src/interfaces/IJob.sol";
import "./interfaces/ITopUp.sol";

interface SequencerLike {
    function numJobs() external view returns (uint256);

    function jobAt(uint256 index) external view returns (address);
}

/// @title DssCronKeeper
/// @notice Checks for Maker protocol's cron jobs that need work and runs them.
/// Additionally it calls the top up contract if upkeep funding is needed.
contract DssCronKeeper is KeeperCompatibleInterface, Ownable {
    SequencerLike public immutable sequencer;
    ITopUp public topUp;
    bytes32 public network;

    constructor(address _sequencer, bytes32 _network) {
        sequencer = SequencerLike(_sequencer);
        network = _network;
    }

    /// @notice Checks whether upkeep balance needs to be topped up
    /// or if there is a workable job
    /// @inheritdoc KeeperCompatibleInterface
    function checkUpkeep(bytes calldata)
        external
        override
        returns (bool, bytes memory)
    {
        if (address(topUp) != address(0) && topUp.check()) {
            return (true, abi.encodeWithSelector(this.runTopUp.selector));
        }
        (address job, bytes memory args) = getWorkableJob();
        if (job != address(0)) {
            return (true, abi.encodeWithSelector(this.runJob.selector, job, args));
        }
        return (false, "");
    }

    /// @notice Executes the requested function from checkUpkeep result
    /// @dev Called by the keeper
    /// @inheritdoc KeeperCompatibleInterface
    function performUpkeep(bytes calldata performData) external override {
        (bool success, ) = address(this).delegatecall(performData);
        require(success, "failed to perform upkeep");
    }

    /// @notice Executes a job with params
    /// @dev work function checks if job is still pending and it's still network's turn,
    /// otherwise it throws an error
    /// @param job address
    /// @param args to pass to the work function
    function runJob(address job, bytes memory args) public {
        IJob(job).work(network, args);
    }

    /// @notice Calls the associated top up contract to fund the upkeep
    function runTopUp() public {
        topUp.run();
    }

    /// @notice Finds a job pending to be executed and it's the network's turn
    /// @return job address
    /// @return args for the job's work function
    function getWorkableJob() internal returns (address, bytes memory) {
        for (uint256 i = 0; i < sequencer.numJobs(); i++) {
            address job = sequencer.jobAt(i);
            (bool canWork, bytes memory args) = IJob(job).workable(network);
            if (canWork) return (job, args);
        }
        return (address(0), "");
    }

    // ------------------------
    // Admin functions
    // ------------------------
    function setTopUp(address _topUp) external onlyOwner {
        topUp = ITopUp(_topUp);
    }
}
