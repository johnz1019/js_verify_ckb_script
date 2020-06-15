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
  toHexInLittleEndian,
} from '@nervosnetwork/ckb-sdk-utils';

import ECPair from './utils/ecpair';
import { Secp256R1 } from './lock/secp256R1Sha256';

const ckb = new CKB(process.env.NODE_URL);

const priKey = '0x2a5a07ec16b7854ac27067550e153d3e58d514bc766472ded639ef2bea25abff';
const ecpair = new ECPair(chain.privateKey2, { compressed: false });

const pubkey2 = '0x' + ecpair.publicKey.substr(4);
console.log('pubkey', pubkey2);

const sign = ecpair.signRecoverable(Buffer.from('aaa'));

console.log('sign', sign);

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

async function sendCKBToR1Lock() {
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
    codeHash: scriptToHash(chain.sep256R1LockCell.type),
    hashType: 'type',
    args: pubkey2,
  };
  changeOutputLock(rawTx, oldOutputLockHash, newOutputLock);

  rawTx.witnesses = rawTx.inputs.map(() => '0x');
  rawTx.witnesses[0] = { lock: '', inputType: '', outputType: '' };
  const signedTx = ckb.signTransaction(chain.privateKey1)(rawTx, []);
  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

async function sendCKBFromR1Lock() {
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

  const capacity = 1000;

  const inputLockHash = scriptToHash({
    codeHash: scriptToHash(chain.sep256R1LockCell.type),
    hashType: 'type',
    args: pubkey2,
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
  /*change cell*/
  const newOutputLock: CKBComponents.Script = {
    codeHash: scriptToHash(chain.keccak256LockCell.type),
    hashType: 'type',
    args: pubkey2,
  };
  changeOutputLock(rawTx, oldOutputLockHash, newOutputLock);

  rawTx.cellDeps.push({ outPoint: chain.sep256R1LockCell.outPoint, depType: 'code' });

  rawTx.witnesses = rawTx.inputs.map(() => '0x');
  rawTx.witnesses[0] = { lock: '', inputType: '', outputType: '' };

  const signedTx = new Secp256R1(ckb).signTransaction(rawTx, chain.privateKey2);
  console.log('rawTx is', JSON.stringify(signedTx));

  const realTxHash = await ckb.rpc.sendTransaction(signedTx);
  console.log(`The real transaction hash is: ${realTxHash}`);
}

// sendCKBToR1Lock();
sendCKBFromR1Lock();
