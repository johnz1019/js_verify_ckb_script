import * as chain from './config/chain';

import CKB from '@nervosnetwork/ckb-sdk-core';
import { Deployer } from './deployer';
import {
  privateKeyToPublicKey,
  scriptToHash,
  privateKeyToAddress,
  AddressPrefix,
  AddressType,
  parseAddress,
} from '@nervosnetwork/ckb-sdk-utils';
import blake160 from '@nervosnetwork/ckb-sdk-utils/lib/crypto/blake160';

import * as EthLib from 'eth-lib';
import { Secp256Keccak } from './lock/secp256Keccak';
import { numberToHex, hexToNumber } from 'web3-utils';

const ckb = new CKB(process.env.NODE_URL);
const pubKeyHash = `0x${blake160(privateKeyToPublicKey(chain.privateKey1), 'hex')}`;

console.log('pubKeyHash is', pubKeyHash);

async function getUnspentCell(lockHash: string): Promise<CachedCell[]> {
  const unspentCells = await ckb.loadCells({ lockHash });

  return unspentCells;
}

function changeOutputLock(tx: CKBComponents.RawTransactionToSign, oldLockHash: string, newLock: CKBComponents.Script) {
  for (const output of tx.outputs) {
    if (scriptToHash(output.lock) === oldLockHash) {
      output.lock = newLock;
    }
  }
}

async function sendCKBToKeccakLock() {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(chain.privateKey1, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });

  const to = privateKeyToAddress(chain.privateKey2, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });
  const toEthAddress = EthLib.Account.fromPrivate(chain.privateKey2).address;
  const capacity = 10000;

  const inputLockHash = scriptToHash({
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  });
  const unspentCells = await getUnspentCell(inputLockHash);

  const rawTx = ckb.generateRawTransaction({
    fromAddress: from,
    toAddress: to,
    capacity: BigInt(capacity * 10 ** 8),
    fee: BigInt(100000),
    cells: unspentCells,
    deps: secp256k1Dep,
    safeMode: true,
  });

  const oldOutputLock: CKBComponents.Script = {
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(to, 'hex').slice(6)}`,
  };
  const oldOutputLockHash = scriptToHash(oldOutputLock);
  const newOutputLock: CKBComponents.Script = {
    codeHash: scriptToHash(chain.keccak256LockCell.type),
    hashType: 'type',
    args: toEthAddress,
  };
  changeOutputLock(rawTx, oldOutputLockHash, newOutputLock);

  rawTx.witnesses = rawTx.inputs.map(() => '0x');
  rawTx.witnesses[0] = { lock: '', inputType: '', outputType: '' };
  const signedTx = ckb.signTransaction(chain.privateKey1)(rawTx, []);
  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

async function sendCKBToKeccakLockWithAnyoneCanPay() {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(chain.privateKey1, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });

  const to = privateKeyToAddress(chain.privateKey2, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });
  const toEthAddress = EthLib.Account.fromPrivate(chain.privateKey2).address;
  const capacity = 1;

  const inputLockHash = scriptToHash({
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  });
  const unspentCells = await getUnspentCell(inputLockHash);

  const rawTx = ckb.generateRawTransaction({
    fromAddress: from,
    toAddress: to,
    capacity: BigInt(capacity * 10 ** 8),
    fee: BigInt(100000),
    cells: unspentCells,
    deps: secp256k1Dep,
    safeMode: true,
    capacityThreshold: '0x0',
  });

  const oldOutputLock: CKBComponents.Script = {
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(to, 'hex').slice(6)}`,
  };
  const oldOutputLockHash = scriptToHash(oldOutputLock);
  const newOutputLock: CKBComponents.Script = {
    codeHash: scriptToHash(chain.keccak256LockCell.type),
    hashType: 'type',
    args: toEthAddress,
  };
  changeOutputLock(rawTx, oldOutputLockHash, newOutputLock);

  const newOutputLockHash = scriptToHash(newOutputLock);
  const anyoneCanPayCells = await getUnspentCell(newOutputLockHash);
  const anyoneCanPayCell = anyoneCanPayCells[0];

  rawTx.inputs.unshift({ previousOutput: anyoneCanPayCell.outPoint, since: '0x0' });

  rawTx.outputs[0].capacity = numberToHex(hexToNumber(anyoneCanPayCell.capacity) + capacity);

  rawTx.cellDeps.push({ outPoint: chain.keccak256LockCell.outPoint, depType: 'code' });

  rawTx.witnesses = rawTx.inputs.map(() => '0x');
  const emptyWitness = { lock: '', inputType: '', outputType: '' };
  rawTx.witnesses[0] = emptyWitness;
  rawTx.witnesses[1] = emptyWitness;

  const keyMap = new Map<string, string>();
  keyMap.set(inputLockHash, chain.privateKey1);
  keyMap.set(newOutputLockHash, chain.privateKey1);
  const cells = [...unspentCells, anyoneCanPayCell];

  const signedTx = ckb.signTransaction(keyMap)(rawTx, cells);
  console.log('signedTx', JSON.stringify(signedTx));
  signedTx.witnesses[0] = '0x';

  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

async function sendCKBFromKeccakLock() {
  const secp256k1Dep = await ckb.loadSecp256k1Dep();
  const from = privateKeyToAddress(chain.privateKey2, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });
  const to = privateKeyToAddress(chain.privateKey1, {
    prefix: AddressPrefix.Testnet,
    type: AddressType.HashIdx,
    codeHashOrCodeHashIndex: '0x00',
  });
  const fromEthAddress = EthLib.Account.fromPrivate(chain.privateKey2).address;
  const capacity = 100;

  const inputLockHash = scriptToHash({
    codeHash: scriptToHash(chain.keccak256LockCell.type),
    hashType: 'type',
    args: fromEthAddress,
  });
  const unspentCells = await getUnspentCell(inputLockHash);

  const rawTx = ckb.generateRawTransaction({
    fromAddress: from,
    toAddress: to,
    capacity: BigInt(capacity * 10 ** 8),
    fee: BigInt(100000),
    cells: unspentCells,
    deps: secp256k1Dep,
    safeMode: true,
  });

  const oldOutputLock: CKBComponents.Script = {
    codeHash: chain.blockAssemblerCode,
    hashType: 'type',
    args: `0x${parseAddress(from, 'hex').slice(6)}`,
  };
  const oldOutputLockHash = scriptToHash(oldOutputLock);
  const newOutputLock: CKBComponents.Script = {
    codeHash: scriptToHash(chain.keccak256LockCell.type),
    hashType: 'type',
    args: fromEthAddress,
  };
  changeOutputLock(rawTx, oldOutputLockHash, newOutputLock);

  rawTx.cellDeps.push({ outPoint: chain.keccak256LockCell.outPoint, depType: 'code' });

  rawTx.witnesses = rawTx.inputs.map(() => '0x');
  rawTx.witnesses[0] = { lock: '', inputType: '', outputType: '' };

  const signedTx = new Secp256Keccak(ckb).signETHTransaction(unspentCells, rawTx, chain.privateKey2, true);

  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

// sendCKBToKeccakLock();

// sendCKBToKeccakLockWithAnyoneCanPay();

sendCKBFromKeccakLock();
