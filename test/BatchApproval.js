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
    const shouldFail = async (codeToRun, expectedError, unwantedSuccessError) => {
        try {
            await codeToRun();
            throw new Error(unwantedSuccessError);
        } catch (err) {
            if (err.reason !== expectedError) {
                throw err;
            }
        }
    };

    const mintNotesArray = async (publicKey, values, contractAddress) => {
        const notesArray = [];
        for (let i = 0; i < values.length; i++) {
            notesArray[i] = await aztec.note.create(publicKey, values[i], contractAddress);
        }
        return notesArray;
    };

    const sum = (arrayToSum) => arrayToSum.reduce((a,b) => a+b, 0);

    const alice     = secp256k1.accountFromPrivateKey(process.env.GANACHE_TESTING_ACCOUNT_0);
    const bob       = secp256k1.accountFromPrivateKey(process.env.GANACHE_TESTING_ACCOUNT_1);
    const charlie   = secp256k1.accountFromPrivateKey(process.env.GANACHE_TESTING_ACCOUNT_2);
    let zkAssetMintableContract;
    let batchApprovalContract;

    let ace;
    let approvedMintedValues;
    let approvedMintedNotes;
    let nonApprovedMintedNotes;
    let nonApprovedMintedValues;
    let foreignMintedNotes;
    let foreignMintedValues;
    before(async () => {
        zkAssetMintableContract = await ZkAssetMintable.deployed();
        batchApprovalContract = await BatchApproval.new(ACE.address, {from: alice.address});
        ace = await ACE.at(ACE.address);

        approvedMintedValues = [50,75,100];
        approvedMintedNotes = await mintNotesArray(alice.publicKey, approvedMintedValues, batchApprovalContract.address);
        nonApprovedMintedValues = [25,125];
        nonApprovedMintedNotes = await mintNotesArray(alice.publicKey, nonApprovedMintedValues, batchApprovalContract.address);
        foreignMintedValues = [50,75,100];
        foreignMintedNotes = await mintNotesArray(alice.publicKey, foreignMintedValues, batchApprovalContract.address);
    });

    it('owner of the contract should be able to mint notes that are owned by the contract', async () => {
        let allValues = approvedMintedValues.concat(nonApprovedMintedValues).concat(foreignMintedValues);
        let allNotes = approvedMintedNotes.concat(nonApprovedMintedNotes).concat(foreignMintedNotes);

        const newMintCounterNote = await aztec.note.create(alice.publicKey, sum(allValues));
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

    it('owner of the contract should be able to approve notes that are owned by the contract to be spent by the contract', async () => {
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
        const invoiceAmount = 100;
        const invoice = await aztec.note.create(bob.publicKey, invoiceAmount);
        const change = await aztec.note.create(alice.publicKey, sum(approvedMintedValues) - invoiceAmount, batchApprovalContract.address);

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
        const invoiceAmount = 100;
        const invoice = await aztec.note.create(bob.publicKey, invoiceAmount);
        const change = await aztec.note.create(alice.publicKey, sum(nonApprovedMintedValues) - invoiceAmount, batchApprovalContract.address);
        const sendProof = new JoinSplitProof(
            nonApprovedMintedNotes,
            [invoice, change],
            batchApprovalContract.address,
            0,
            batchApprovalContract.address,
        );

        const sendProofData = sendProof.encodeABI(zkAssetMintableContract.address);
        await shouldFail(async () => {
            await batchApprovalContract.proofValidation(sendProofData, zkAssetMintableContract.address, batchApprovalContract.address);
        }, 'sender does not have approval to spend input note', 'JoinSplit succeeds but notes are not approved');
    });

    it('the contract shouldn\'t be able to spend notes that it has already spent', async () => {
        const invoiceAmount = 100;
        const invoice = await aztec.note.create(bob.publicKey, invoiceAmount);
        const change = await aztec.note.create(alice.publicKey, sum(approvedMintedValues) - invoiceAmount, batchApprovalContract.address);

        const sendProof = new JoinSplitProof(
            approvedMintedNotes,
            [invoice, change],
            batchApprovalContract.address,
            0,
            batchApprovalContract.address,
        );

        const sendProofData = sendProof.encodeABI(zkAssetMintableContract.address);
        await shouldFail(async () => {
            await batchApprovalContract.proofValidation(sendProofData, zkAssetMintableContract.address, batchApprovalContract.address);
        }, 'input note status is not UNSPENT', 'JoinSplit succeeds but notes should already be spent');
    });

    it('owner of the contract should be able to approve notes for spending by another person', async () => {
        const noteHashes = foreignMintedNotes.map(note => note.noteHash);
        await batchApprovalContract.batchApprove(noteHashes, zkAssetMintableContract.address, bob.address);

        let note0Approved = await zkAssetMintableContract.confidentialApproved(foreignMintedNotes[0].noteHash, bob.address);
        let note1Approved = await zkAssetMintableContract.confidentialApproved(foreignMintedNotes[1].noteHash, bob.address);
        let note2Approved = await zkAssetMintableContract.confidentialApproved(foreignMintedNotes[2].noteHash, bob.address);
        expect(note0Approved && note1Approved && note2Approved).to.equal(true);
    });

    // it('another person should be able to spend notes owned by the contract after they have been approved for them to spend', async () => {
    //     const invoice = await aztec.note.create(charlie.publicKey, 100);
    //     const change = await aztec.note.create(bob.publicKey, 125, batchApprovalContract.address);

    //     const sendProof = new JoinSplitProof(
    //         foreignMintedNotes,
    //         [invoice, change],
    //         batchApprovalContract.address,
    //         0,
    //         batchApprovalContract.address,
    //     );

    //     const sendProofData = sendProof.encodeABI(zkAssetMintableContract.address);
    //     let result = await batchApprovalContract.proofValidation(sendProofData, zkAssetMintableContract.address, batchApprovalContract.address);
    //     expect(result.receipt.status).to.equal(true);
    // });

    it('the contract shouldn\'t be able to approve notes for itself to spend that have already been spent', async () => {
        const noteHashes = approvedMintedNotes.map(note => note.noteHash);
        await shouldFail(async () => {
            await batchApprovalContract.batchApprove(noteHashes, zkAssetMintableContract.address, batchApprovalContract.address);
        }, 'only unspent notes can be approved', 'approval for this address succeeds but notes should already be spent so it should be impossible to approve them');
    });

    it('the contract shouldn\'t be able to approve notes for another address to spend that have already been spent', async () => {
        const noteHashes = approvedMintedNotes.map(note => note.noteHash);
        await shouldFail(async () => {
            await batchApprovalContract.batchApprove(noteHashes, zkAssetMintableContract.address, bob.address);
        }, 'only unspent notes can be approved', 'approval for another address succeeds but notes should already be spent so it should be impossible to approve them');
    });
});