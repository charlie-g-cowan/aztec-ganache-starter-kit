/* global-artifacts, expect, contract, it:true */

import utils from '@aztec/dev-utils';
import Web3 from 'web3';

const aztec = require('aztec.js');
const dotenv = require('dotenv');
dotenv.config();
const secp256k1 = require('@aztec/secp256k1');

const ACE = artifacts.require('./ACE.sol');

const ZkAssetMintable = artifacts.require('./ZkAssetMintable.sol');
const JoinSplit = artifacts.require('@aztec/protocol/contracts/ACE/validators/joinSplit/JoinSplit.sol');
const BatchApproval = artifacts.require('./BatchApproval.sol');

const {
    proofs: {
        MINT_PROOF,
        JOIN_SPLIT_PROOF,
    },
} = utils;

const { JoinSplitProof, MintProof } = aztec;

contract('BatchApproval', async (accounts) => {
    const alice = secp256k1.accountFromPrivateKey(process.env.GANACHE_TESTING_ACCOUNT_0);
    const bob   = secp256k1.accountFromPrivateKey(process.env.GANACHE_TESTING_ACCOUNT_1);
    let zkAssetMintableContract;
    let batchApprovalContract;
    let joinSplitContract;
    let ace;
    before(async () => {
        zkAssetMintableContract = await ZkAssetMintable.deployed();
        batchApprovalContract = await BatchApproval.new(ACE.address, {from: alice.address});
        joinSplitContract = await JoinSplit.deployed();
        ace = await ACE.at(ACE.address);
    });

    let mintedNotes;

    it('owner of the contract should be able to mint notes that are owned by the contract', async () => {
        mintedNotes = [];
        mintedNotes[0] = await aztec.note.create(alice.publicKey, 50, batchApprovalContract.address);
        mintedNotes[1] = await aztec.note.create(alice.publicKey, 75, batchApprovalContract.address);
        mintedNotes[2] = await aztec.note.create(alice.publicKey, 100, batchApprovalContract.address);

        const newMintCounterNote = await aztec.note.create(alice.publicKey, 225);
        const zeroMintCounterNote = await aztec.note.createZeroValueNote();
        const sender = zkAssetMintableContract.address;

        const mintProof = new MintProof(
            zeroMintCounterNote,
            newMintCounterNote,
            mintedNotes,
            sender,
        );

        const mintData = mintProof.encodeABI();


        await zkAssetMintableContract.confidentialMint(MINT_PROOF, mintData, {from: alice.address});
        expect(await ace.getNote(zkAssetMintableContract.address, mintedNotes[0].noteHash)).to.not.equal(undefined);
    });

    it('owner of the contract should be able to approve notes that are owned by the contract to be spent', async () => {
        const noteHashes = mintedNotes.map(note => note.noteHash);
        await batchApprovalContract.batchApprove(noteHashes, zkAssetMintableContract.address, batchApprovalContract.address);

        let note0Approved = await zkAssetMintableContract.confidentialApproved(mintedNotes[0].noteHash, batchApprovalContract.address);
        let note1Approved = await zkAssetMintableContract.confidentialApproved(mintedNotes[1].noteHash, batchApprovalContract.address);
        let note2Approved = await zkAssetMintableContract.confidentialApproved(mintedNotes[2].noteHash, batchApprovalContract.address);
        expect(note0Approved && note1Approved && note2Approved).to.equal(true);
    });
});