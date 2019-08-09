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

    let approvedMintedNotes;
    let nonApprovedMintedNotes;

    it('owner of the contract should be able to mint notes that are owned by the contract', async () => {
        approvedMintedNotes = [];
        approvedMintedNotes[0] = await aztec.note.create(alice.publicKey, 50, batchApprovalContract.address);
        approvedMintedNotes[1] = await aztec.note.create(alice.publicKey, 75, batchApprovalContract.address);
        approvedMintedNotes[2] = await aztec.note.create(alice.publicKey, 100, batchApprovalContract.address);
        nonApprovedMintedNotes = [];
        nonApprovedMintedNotes[0] = await aztec.note.create(alice.publicKey, 25, batchApprovalContract.address);
        nonApprovedMintedNotes[1] = await aztec.note.create(alice.publicKey, 125, batchApprovalContract.address);
        let allNotes = approvedMintedNotes.concat(nonApprovedMintedNotes);

        const newMintCounterNote = await aztec.note.create(alice.publicKey, 375);
        const zeroMintCounterNote = await aztec.note.createZeroValueNote();
        const sender = zkAssetMintableContract.address;

        const mintProof = new MintProof(
            zeroMintCounterNote,
            newMintCounterNote,
            allNotes,
            sender,
        );

        const mintData = mintProof.encodeABI();


        await zkAssetMintableContract.confidentialMint(MINT_PROOF, mintData, {from: alice.address});
        expect(await ace.getNote(zkAssetMintableContract.address, approvedMintedNotes[0].noteHash)).to.not.equal(undefined);
        expect(await ace.getNote(zkAssetMintableContract.address, approvedMintedNotes[1].noteHash)).to.not.equal(undefined);
        expect(await ace.getNote(zkAssetMintableContract.address, approvedMintedNotes[2].noteHash)).to.not.equal(undefined);
        expect(await ace.getNote(zkAssetMintableContract.address, nonApprovedMintedNotes[0].noteHash)).to.not.equal(undefined);
        expect(await ace.getNote(zkAssetMintableContract.address, nonApprovedMintedNotes[1].noteHash)).to.not.equal(undefined);
    });

    it('owner of the contract should be able to approve notes that are owned by the contract to be spent', async () => {
        const noteHashes = approvedMintedNotes.map(note => note.noteHash);
        await batchApprovalContract.batchApprove(noteHashes, zkAssetMintableContract.address, batchApprovalContract.address);

        let note0Approved = await zkAssetMintableContract.confidentialApproved(approvedMintedNotes[0].noteHash, batchApprovalContract.address);
        let note1Approved = await zkAssetMintableContract.confidentialApproved(approvedMintedNotes[1].noteHash, batchApprovalContract.address);
        let note2Approved = await zkAssetMintableContract.confidentialApproved(approvedMintedNotes[2].noteHash, batchApprovalContract.address);
        let note0nonApproved = await zkAssetMintableContract.confidentialApproved(nonApprovedMintedNotes[0].noteHash, batchApprovalContract.address);
        let note1nonApproved = await zkAssetMintableContract.confidentialApproved(nonApprovedMintedNotes[1].noteHash, batchApprovalContract.address);
        expect(note0Approved && note1Approved && note2Approved && !note0nonApproved && !note1nonApproved).to.equal(true);
    });

    it('the contract should be able to spend notes after they have been approved for it to spend', async () => {
        const invoice = await aztec.note.create(bob.publicKey, 100);
        const change = await aztec.note.create(alice.publicKey, 125, batchApprovalContract.address);
        
        const sendProof = new JoinSplitProof(
            approvedMintedNotes,
            [invoice, change],
            batchApprovalContract.address,
            0,
            batchApprovalContract.address,
        );

        const sendProofData = sendProof.encodeABI(zkAssetMintableContract.address);
        let result = await batchApprovalContract.proofValidation(sendProofData, zkAssetMintableContract.address, batchApprovalContract.address);
        expect(result.receipt.status).to.equal(true);
    });

    it('the contract shouldn\'t be able to spend unapproved notes', async() => {
        const invoice = await aztec.note.create(bob.publicKey, 100);
        const change = await aztec.note.create(alice.publicKey, 50, batchApprovalContract.address);
        const sendProof = new JoinSplitProof(
            nonApprovedMintedNotes,
            [invoice, change],
            batchApprovalContract.address,
            0,
            batchApprovalContract.address,
        );

        const sendProofData = sendProof.encodeABI(zkAssetMintableContract.address);
        try {
            await batchApprovalContract.proofValidation(sendProofData, zkAssetMintableContract.address, batchApprovalContract.address);
            throw new Error('JoinSplit succeeds but notes are not approved');
        } catch (err) {
            if (err.reason !== 'sender does not have approval to spend input note') {
                throw err;
            }
        }
    });

    it('the contract shouldn\'t be able to spend notes that it has already spent', async () => {
        const invoice = await aztec.note.create(bob.publicKey, 100);
        const change = await aztec.note.create(alice.publicKey, 125, batchApprovalContract.address);
        
        const sendProof = new JoinSplitProof(
            approvedMintedNotes,
            [invoice, change],
            batchApprovalContract.address,
            0,
            batchApprovalContract.address,
        );

        const sendProofData = sendProof.encodeABI(zkAssetMintableContract.address);
        try {
            await batchApprovalContract.proofValidation(sendProofData, zkAssetMintableContract.address, batchApprovalContract.address);
            throw new Error('JoinSplit succeeds but notes should already be spent')
        } catch (err) {
            if (err.reason !== 'input note status is not UNSPENT') {
                throw err;
            }
        }
    });

});