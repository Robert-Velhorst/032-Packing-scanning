import {describe,expect,it} from 'vitest';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AccountStore} from './accounts.ts';
import {sharedPackingRecords} from '../src/shared-packs.ts';
import {createInitialData} from '../src/seed.ts';
const credentials={username:'house-owner',name:'Synthetic owner',password:'synthetic household passphrase 032'},key=Buffer.alloc(32,12);
async function accounts(store:AccountStore){const a=await store.register(credentials,'owner'),b=await store.register({...credentials,username:'house-member',name:'Synthetic member'},'member'),c=await store.register({...credentials,username:'house-outsider',name:'Synthetic outsider'},'outsider');return {a:a.session,b:b.session,c:c.session};}
describe('private household membership and shared packs',()=>{
  it('bounds household work without changing local or shared records and reopens after the window',async()=>{let now=1000;const store=new AccountStore(':memory:',key,()=>now);try{const account=await store.register(credentials,'owner'),house=store.createHousehold(account.session,{name:'Family'});for(let i=0;i<180;i++)store.guardHouseholdRequests(account.session,'peer');expect(()=>store.guardHouseholdRequests(account.session,'peer')).toThrow(/Too many household/);expect(store.households(account.session)[0].id).toBe(house.id);now+=15*60*1000;expect(()=>store.guardHouseholdRequests(account.session,'peer')).not.toThrow();}finally{store.close();}},15000);
  it('binds invitations to an account, requires consent, consumes once, revokes and expires without public data',async()=>{
    let now=1000;const store=new AccountStore(':memory:',key,()=>now);try{const {a,b,c}=await accounts(store),house=store.createHousehold(a,{name:'Private synthetic family'}),invite=store.inviteHousehold(a,house.id,{username:b.profile.username});
      expect(()=>store.household(c,house.id)).toThrow(/unavailable/);expect(()=>store.joinHousehold(c,{code:invite.code,consent:true},'outsider')).toThrow(/unavailable/);expect(()=>store.joinHousehold(b,{code:invite.code},'member')).toThrow(/Confirm/);
      const results=await Promise.allSettled([1,2].map(()=>Promise.resolve().then(()=>store.joinHousehold(b,{code:invite.code,consent:true},'member'))));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(store.household(b,house.id).invitations).toEqual([]);
      const later=store.inviteHousehold(a,house.id,{username:c.profile.username});store.revokeInvitation(a,house.id,later.id);expect(()=>store.joinHousehold(c,{code:later.code,consent:true},'outsider')).toThrow(/unavailable/);
      const expired=store.inviteHousehold(a,house.id,{username:c.profile.username});now+=49*60*60*1000;expect(()=>store.joinHousehold(c,{code:expired.code,consent:true},'outsider')).toThrow(/unavailable/);
    }finally{store.close();}
  },20000);
  it('encrypts group and selected pack records, persists, rejects stale revisions and isolates the private vault',async()=>{
    const root=await mkdtemp(join(tmpdir(),'packing-household-')),file=join(root,'accounts.sqlite');let store=new AccountStore(file,key);let packId='',houseId='';try{const {a,b,c}=await accounts(store),house=store.createHousehold(a,{name:'Private synthetic family'}),invite=store.inviteHousehold(a,house.id,{username:b.profile.username});store.joinHousehold(b,{code:invite.code,consent:true},'member');const records=sharedPackingRecords(createInitialData(),'sample-trip');records.trip.name='Private synthetic shared travel';
      expect(()=>store.saveSharedPack(a,house.id,{records})).toThrow(/Confirm/);const pack=store.saveSharedPack(a,house.id,{records,consent:true});packId=pack.id;houseId=house.id;expect(store.sharedPack(b,house.id,pack.id).records).toEqual(records);expect(store.vault(b).backup).toBeNull();expect(()=>store.sharedPack(c,house.id,pack.id)).toThrow(/unavailable/);
      const changed=structuredClone(records);changed.trip.name='Second synthetic shared version';store.saveSharedPack(b,house.id,{records:changed,consent:true,revision:1},pack.id);expect(()=>store.saveSharedPack(a,house.id,{records,consent:true,revision:1},pack.id)).toThrow(/changed/);expect(store.sharedPack(a,house.id,pack.id).records).toEqual(changed);
      expect(()=>store.deleteSharedPack(a,house.id,pack.id,{revision:1,confirm:true})).toThrow(/changed/);expect(()=>store.deleteSharedPack(b,house.id,pack.id,{revision:2,confirm:true})).toThrow(/owner/);store.removeMember(a,house.id,b.profile.id);expect(()=>store.saveSharedPack(b,house.id,{records,consent:true,revision:2},pack.id)).toThrow(/unavailable/);
    }finally{store.close();}const bytes=await readFile(file);expect(bytes.includes(Buffer.from('Private synthetic family'))).toBe(false);expect(bytes.includes(Buffer.from('Second synthetic shared version'))).toBe(false);
    store=new AccountStore(file,key);try{const session=await store.login(credentials,'owner');expect(store.sharedPack(session,houseId,packId).revision).toBe(2);expect(store.exportAccount(session).households[0].packs[0].id).toBe(packId);}finally{store.close();}
  },20000);
  it('protects owner and member authority, transfers ownership, and makes account deletion explicit',async()=>{
    const store=new AccountStore(':memory:',key);try{const {a,b,c}=await accounts(store),house=store.createHousehold(a,{name:'Family'}),invite=store.inviteHousehold(a,house.id,{username:b.profile.username});store.joinHousehold(b,{code:invite.code,consent:true},'member');
      expect(()=>store.inviteHousehold(b,house.id,{username:c.profile.username})).toThrow(/owner/);expect(()=>store.removeMember(b,house.id,a.profile.id)).toThrow(/Transfer/);await expect(store.deleteAccount(a,{password:credentials.password,confirm:true},'owner')).rejects.toMatchObject({status:409});
      await expect(store.transferHousehold(a,house.id,{userId:b.profile.id,password:'wrong synthetic password',confirm:true},'owner')).rejects.toMatchObject({status:401});await store.transferHousehold(a,house.id,{userId:b.profile.id,password:credentials.password,confirm:true},'owner');expect(store.household(b,house.id).ownerId).toBe(b.profile.id);
      await store.deleteAccount(a,{password:credentials.password,confirm:true},'owner');expect(store.household(b,house.id).members).toHaveLength(1);await store.deleteHousehold(b,house.id,{password:credentials.password,confirm:true},'member');expect(store.households(b)).toEqual([]);
    }finally{store.close();}
  },20000);
  it('limits owned groups and selected packs and preserves records after invalid uploads',async()=>{
    const store=new AccountStore(':memory:',key);try{const a=await store.register(credentials,'owner');for(let i=0;i<5;i++)store.createHousehold(a.session,{name:`Family ${i}`});expect(()=>store.createHousehold(a.session,{name:'Too many'})).toThrow(/limit/);const house=store.households(a.session)[0],records=sharedPackingRecords(createInitialData(),'sample-trip');for(let i=0;i<10;i++)store.saveSharedPack(a.session,house.id,{records,consent:true});expect(()=>store.saveSharedPack(a.session,house.id,{records,consent:true})).toThrow(/10 shared packs/);const invalid=structuredClone(records);invalid.libraryItems[0].photoId='private';expect(()=>store.saveSharedPack(a.session,house.id,{records:invalid,consent:true,revision:1},store.household(a.session,house.id).packs[0].id)).toThrow(/without photos/);expect(store.household(a.session,house.id).packs.every(p=>p.revision===1)).toBe(true);
    }finally{store.close();}
  },15000);
});
