// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract FundsHeldVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_ACTIVE_EARMARKS = 64;
    uint256 public constant MAX_DURATION = 366 days;
    IERC20 public immutable token;

    enum Status { Pending, Locked, Expired, Revoked, Released }

    struct Earmark {
        address owner;
        uint64 expiry;
        bool acknowledged;
        bool revoked;
        bool released;
        address reader;
        uint128 amount;
        bytes32 memoHash;
    }

    struct Verification {
        address owner;
        address reader;
        uint256 amount;
        uint64 expiry;
        bytes32 memoHash;
        bool acknowledged;
        bool revoked;
        bool released;
        bool active;
        Status status;
        uint256 ownerLockedBalance;
        uint256 ownerReservedBalance;
    }

    mapping(address => uint256) public lockedBalance;
    mapping(uint256 => Earmark) public earmarks;
    mapping(address => uint256[]) private activeCandidates;
    mapping(address => uint256[]) private history;
    uint256 public lastId;

    error InvalidToken();
    error InvalidAmount();
    error InvalidReader();
    error InvalidExpiry();
    error InsufficientFreeBalance();
    error TooManyActiveEarmarks();
    error UnknownEarmark();
    error Unauthorized();
    error InactiveEarmark();
    error AlreadyAcknowledged();
    error AlreadyRevoked();
    error UnexpectedTokenTransfer();

    event Deposited(address indexed owner, address indexed token, uint256 amount);
    event Withdrawn(address indexed owner, address indexed token, uint256 amount);
    event EarmarkIssued(uint256 indexed id, address indexed owner, address indexed reader, uint256 amount, uint64 expiry, bytes32 memoHash);
    event EarmarkRevoked(uint256 indexed id, address indexed owner, address indexed reader, uint256 amount);
    event EarmarkAcknowledged(uint256 indexed id, address indexed reader);
    event EarmarkReleased(uint256 indexed id, address indexed owner, address indexed reader, uint256 amount);
    event EarmarksPruned(address indexed owner, uint256 removed);

    constructor(IERC20 asset) {
        if (address(asset).code.length == 0) revert InvalidToken();
        token = asset;
    }

    function deposit(address asset, uint256 amount) external nonReentrant {
        if (asset != address(token)) revert InvalidToken();
        if (amount == 0) revert InvalidAmount();
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != beforeBalance + amount) revert UnexpectedTokenTransfer();
        lockedBalance[msg.sender] += amount;
        emit Deposited(msg.sender, asset, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (amount > freeBalance(msg.sender)) revert InsufficientFreeBalance();
        lockedBalance[msg.sender] -= amount;
        uint256 beforeVault = token.balanceOf(address(this));
        uint256 beforeOwner = token.balanceOf(msg.sender);
        token.safeTransfer(msg.sender, amount);
        if (token.balanceOf(address(this)) != beforeVault - amount) revert UnexpectedTokenTransfer();
        if (token.balanceOf(msg.sender) != beforeOwner + amount) revert UnexpectedTokenTransfer();
        emit Withdrawn(msg.sender, address(token), amount);
    }

    function issueEarmark(address reader, uint256 amount, uint64 expiry, bytes32 memoHash)
        external nonReentrant returns (uint256 id)
    {
        if (reader == address(0) || reader == msg.sender || reader == address(this)) revert InvalidReader();
        if (amount == 0 || amount > type(uint128).max) revert InvalidAmount();
        if (expiry <= block.timestamp || expiry > block.timestamp + MAX_DURATION) revert InvalidExpiry();

        (, uint256 reserved) = _prune(msg.sender);
        uint256[] storage candidates = activeCandidates[msg.sender];
        if (amount > lockedBalance[msg.sender] - reserved) revert InsufficientFreeBalance();
        if (candidates.length == MAX_ACTIVE_EARMARKS) revert TooManyActiveEarmarks();

        id = ++lastId;
        earmarks[id] = Earmark(msg.sender, expiry, false, false, false, reader, uint128(amount), memoHash);
        candidates.push(id);
        history[msg.sender].push(id);
        emit EarmarkIssued(id, msg.sender, reader, amount, expiry, memoHash);
    }

    function revokeEarmark(uint256 id) external nonReentrant {
        Earmark storage mark = _get(id);
        if (mark.owner != msg.sender) revert Unauthorized();
        if (mark.revoked) revert AlreadyRevoked();
        if (!_active(mark)) revert InactiveEarmark();
        if (mark.acknowledged) revert AlreadyAcknowledged();
        mark.revoked = true;
        emit EarmarkRevoked(id, msg.sender, mark.reader, mark.amount);
    }

    function acknowledge(uint256 id) external nonReentrant {
        Earmark storage mark = _get(id);
        if (mark.reader != msg.sender) revert Unauthorized();
        if (!_active(mark)) revert InactiveEarmark();
        if (mark.acknowledged) revert AlreadyAcknowledged();
        mark.acknowledged = true;
        emit EarmarkAcknowledged(id, msg.sender);
    }

    /// @notice The named reader gives up the hold early. The funds return to the owner's free balance.
    function releaseEarmark(uint256 id) external nonReentrant {
        Earmark storage mark = _get(id);
        if (mark.reader != msg.sender) revert Unauthorized();
        if (!_active(mark)) revert InactiveEarmark();
        mark.released = true;
        emit EarmarkReleased(id, mark.owner, msg.sender, mark.amount);
    }

    /// @notice Remove expired, revoked and released earmarks from an owner's active list. Anyone may call it.
    function pruneEarmarks(address owner) external nonReentrant returns (uint256 removed) {
        (removed, ) = _prune(owner);
    }

    function activeEarmarkSlots(address owner) external view returns (uint256) {
        return activeCandidates[owner].length;
    }

    function verify(uint256 id) external view returns (Verification memory proof) {
        Earmark storage mark = _get(id);
        proof.owner = mark.owner;
        proof.reader = mark.reader;
        proof.amount = mark.amount;
        proof.expiry = mark.expiry;
        proof.memoHash = mark.memoHash;
        proof.acknowledged = mark.acknowledged;
        proof.revoked = mark.revoked;
        proof.released = mark.released;
        proof.active = _active(mark);
        if (proof.revoked) proof.status = Status.Revoked;
        else if (proof.released) proof.status = Status.Released;
        else if (!proof.active) proof.status = Status.Expired;
        else if (proof.acknowledged) proof.status = Status.Locked;
        proof.ownerLockedBalance = lockedBalance[proof.owner];
        proof.ownerReservedBalance = _reservedBalance(proof.owner);
    }

    function freeBalance(address owner) public view returns (uint256) {
        return lockedBalance[owner] - _reservedBalance(owner);
    }

    function _reservedBalance(address owner) private view returns (uint256 reserved) {
        uint256[] storage candidates = activeCandidates[owner];
        for (uint256 i; i < candidates.length; ++i) {
            Earmark storage mark = earmarks[candidates[i]];
            if (_active(mark)) reserved += mark.amount;
        }
    }

    function earmarkCount(address owner) external view returns (uint256) {
        return history[owner].length;
    }

    function earmarkIdAt(address owner, uint256 index) external view returns (uint256) {
        return history[owner][index];
    }

    /// @dev Swap-and-pop inactive entries; returns how many were removed and the active total that remains.
    function _prune(address owner) private returns (uint256 removed, uint256 reserved) {
        uint256[] storage candidates = activeCandidates[owner];
        uint256 length = candidates.length;
        uint256 i;
        while (i < length) {
            Earmark storage mark = earmarks[candidates[i]];
            if (_active(mark)) {
                reserved += mark.amount;
                ++i;
            } else {
                --length;
                candidates[i] = candidates[length];
                candidates.pop();
                ++removed;
            }
        }
        if (removed != 0) emit EarmarksPruned(owner, removed);
    }

    function _get(uint256 id) private view returns (Earmark storage mark) {
        mark = earmarks[id];
        if (mark.owner == address(0)) revert UnknownEarmark();
    }

    function _active(Earmark storage mark) private view returns (bool) {
        return !mark.revoked && !mark.released && block.timestamp < mark.expiry;
    }
}
