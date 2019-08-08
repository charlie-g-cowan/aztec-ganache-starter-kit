pragma solidity >= 0.5.0 <0.7.0;

import "@aztec/protocol/contracts/ERC1724/ZkAssetMintable.sol";
import "@aztec/protocol/contracts/libs/NoteUtils.sol";
import "@aztec/protocol/contracts/interfaces/IZkAsset.sol";
import "@aztec/protocol/contracts/interfaces/IAZTEC.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";

/**
 * @title   Contract for approving a set of notes to be spent by another party. Simplifies flow for user by only needing to approve one transaction.
 * @author  AZTEC
 */
contract BatchApproval is Ownable, IAZTEC {
    using NoteUtils for bytes;
    address public aceAddress;

    constructor(address _aceAddress) public Ownable() {
        aceAddress = _aceAddress;
    }

    /**
     * @notice              Allows user who owns this contract to approve a set of notes owned by this contract for spending by a party
     * @author              AZTEC
     * @param _noteHashes   An array of hashes of notes (that must be owned by this contract) to to be approved for spending
     * @param _zkAsset      The address of the zkAsset that minted these notes
     * @param _spender      The address of the person or contract that is being approved to spend these notes.
     *                      Can be any person or contract e.g. Bob, a different third-party, a contract, this contract itself.
     */
    function batchApprove(bytes32[] memory _noteHashes, address _zkAsset, address _spender) public onlyOwner {
        for (uint i = 0; i < _noteHashes.length; i++) {
            // (uint8 status, , , address noteOwner) = ACE(aceAddress).getNote(_zkAsset, _noteHashes[i]);
            // require(status == uint8(NoteStatus.UNSPENT));
            (, , , address noteOwner) = ACE(aceAddress).getNote(_zkAsset, _noteHashes[i]);
            require(noteOwner == address(this), "Contract does not own this note.");
        }
        IZkAsset asset = IZkAsset(_zkAsset);
        for (uint j = 0; j < _noteHashes.length; j++) {
            asset.confidentialApprove(_noteHashes[j], _spender, true, '');
        }
    }
}