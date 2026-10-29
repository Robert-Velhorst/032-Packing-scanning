#import "PackingSDKCallbacks.h"
#import <Capacitor/Capacitor.h>
#import <Capacitor/Capacitor-Swift.h>

#if !__has_feature(objc_arc)
#error PackingSDKCallbacks requires ARC for its queue-owned object lifetimes.
#endif

// CAPPluginCall is a legacy, mutable Objective-C object. It never leaves this
// queue-owned registry for Swift actor state. The lock protects table metadata;
// SDK object properties/methods are accessed only on the supplied SDK queue.
@interface PackingCallbackEntry : NSObject
@property(nonatomic, strong) CAPPluginCall *call;
@property(nonatomic, strong) dispatch_queue_t queue;
@property(nonatomic, copy) NSString *owner;
@property(nonatomic, copy) NSString *epoch;
// All terminal/cancellation metadata below is protected by PackingTableLock.
@property(nonatomic) BOOL claimed;
@property(nonatomic) BOOL cancelled;
@property(nonatomic, copy) NSString *cancellationMessage;
@property(nonatomic, copy) NSString *cancellationCode;
@property(nonatomic, copy) PackingCallbackDeliveryGuard deliveryGuard;
@property(nonatomic, copy) NSString *guardFailureMessage;
@property(nonatomic, copy) NSString *guardFailureCode;
@end
@implementation PackingCallbackEntry
@end

@interface PackingCallbackOwner : NSObject
@property(nonatomic, weak) CAPPlugin *plugin;
@property(nonatomic, strong) dispatch_queue_t queue;
@property(nonatomic, copy) dispatch_block_t revoke;
@property(nonatomic, copy) NSString *epoch;
@property(nonatomic) BOOL resetting;
@end
@implementation PackingCallbackOwner
@end

static NSUInteger PackingCancelEpoch(NSString *, NSString *, NSString *, NSString *);
static NSCondition *PackingTableLock;
static NSMutableDictionary<NSString *, PackingCallbackEntry *> *PackingTable;
static NSMutableDictionary<NSString *, PackingCallbackOwner *> *PackingOwners;

static void PackingInitialize(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        PackingTableLock = [[NSCondition alloc] init];
        PackingTable = [[NSMutableDictionary alloc] init];
        PackingOwners = [[NSMutableDictionary alloc] init];
    });
}

BOOL PackingCallbacksBindOwner(CAPPlugin *plugin, dispatch_queue_t sdkQueue, NSString *owner) {
    dispatch_assert_queue(sdkQueue);
    if (owner.length == 0) { return NO; }
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackOwner *existing = PackingOwners[owner];
    if (existing != nil) {
        if (existing.resetting) { [PackingTableLock unlock]; return NO; }
        if (existing.queue == nil) { existing.plugin = plugin; existing.queue = sdkQueue; }
        BOOL same = existing.plugin == plugin && existing.queue == sdkQueue;
        [PackingTableLock unlock];
        return same;
    }
    if (PackingOwners.count >= 64) { [PackingTableLock unlock]; return NO; }
    PackingCallbackOwner *binding = [[PackingCallbackOwner alloc] init];
    binding.plugin = plugin;
    binding.queue = sdkQueue;
    binding.epoch = NSUUID.UUID.UUIDString;
    PackingOwners[owner] = binding;
    [PackingTableLock unlock];
    return YES;
}

BOOL PackingCallbacksResetOwner(NSString *owner, NSString *message, NSString *code) {
    if (owner.length == 0) { return NO; }
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackOwner *binding = PackingOwners[owner];
    if (binding.resetting) { [PackingTableLock unlock]; return NO; }
    if (binding == nil) {
        if (PackingOwners.count >= 64) { [PackingTableLock unlock]; return NO; }
        binding = [[PackingCallbackOwner alloc] init];
        PackingOwners[owner] = binding;
    }
    NSString *previous = binding.epoch;
    dispatch_block_t revoke = binding.revoke;
    binding.revoke = nil;
    binding.epoch = NSUUID.UUID.UUIDString;
    NSString *current = binding.epoch;
    binding.resetting = YES;
    [PackingTableLock unlock];
    if (revoke != nil) { revoke(); }
    PackingCancelEpoch(owner, previous, message, code);
    [PackingTableLock lock];
    if (PackingOwners[owner] == binding && [binding.epoch isEqualToString:current]) {
        binding.resetting = NO;
    }
    [PackingTableLock broadcast];
    [PackingTableLock unlock];
    return YES;
}

NSString *PackingCallbacksOwnerEpoch(NSString *owner) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackOwner *binding = PackingOwners[owner];
    NSString *epoch = binding.resetting ? nil : binding.epoch;
    [PackingTableLock unlock];
    return epoch;
}

NSString *PackingCallbacksTokenEpoch(NSString *token) {
    PackingInitialize();
    [PackingTableLock lock];
    NSString *epoch = PackingTable[token].epoch;
    [PackingTableLock unlock];
    return epoch;
}

BOOL PackingCallbacksSetRevocationForEpoch(NSString *owner, NSString *epoch, dispatch_block_t revoke) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackOwner *binding = PackingOwners[owner];
    BOOL accepted = binding != nil && !binding.resetting && [binding.epoch isEqualToString:epoch];
    if (accepted) { binding.revoke = revoke; }
    [PackingTableLock unlock];
    if (!accepted) { revoke(); }
    return accepted;
}

BOOL PackingCallbacksSetOwnerRevocation(NSString *owner, dispatch_block_t revoke) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackOwner *binding = PackingOwners[owner];
    BOOL accepted = binding != nil && !binding.resetting;
    if (accepted) { binding.revoke = revoke; }
    [PackingTableLock unlock];
    // An owner may disappear while UI work opens its lease. Revoke that lease
    // immediately rather than storing an orphan key. Never call under table lock.
    if (!accepted) { revoke(); }
    return accepted;
}

void PackingCallbacksUnbindOwner(NSString *owner, NSString *message, NSString *code) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackOwner *binding = PackingOwners[owner];
    while (binding != nil && binding.resetting) {
        [PackingTableLock wait];
        binding = PackingOwners[owner];
    }
    if (binding == nil) {
        [PackingTableLock unlock];
        PackingCancelEpoch(owner, nil, message, code);
        return;
    }
    dispatch_block_t revoke = binding.revoke;
    binding.revoke = nil;
    binding.resetting = YES;
    [PackingTableLock unlock];
    if (revoke != nil) { revoke(); }
    PackingCallbacksCancelOwner(owner, message, code);
    [PackingTableLock lock];
    if (PackingOwners[owner] == binding) { [PackingOwners removeObjectForKey:owner]; }
    [PackingTableLock broadcast];
    [PackingTableLock unlock];
}

static BOOL PackingNotifyOwner(NSString *owner, NSString *expectedEpoch, NSString *event, NSData *json) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackOwner *binding = PackingOwners[owner];
    NSString *epoch = binding.epoch;
    dispatch_queue_t queue = binding.queue;
    BOOL matches = !binding.resetting && (expectedEpoch == nil || [epoch isEqualToString:expectedEpoch]);
    [PackingTableLock unlock];
    if (binding == nil || queue == nil || !matches) { return NO; }
    NSString *name = [event copy];
    NSString *identity = [owner copy];
    NSData *bytes = [json copy];
    dispatch_async(queue, ^{
        dispatch_assert_queue(queue);
        [PackingTableLock lock];
        BOOL current = PackingOwners[identity] == binding && !binding.resetting && [binding.epoch isEqualToString:epoch];
        [PackingTableLock unlock];
        if (!current) { return; }
        CAPPlugin *plugin = binding.plugin;
        if (plugin == nil) { return; }
        NSError *error = nil;
        id result = [NSJSONSerialization JSONObjectWithData:bytes options:0 error:&error];
        if (error == nil && [result isKindOfClass:NSDictionary.class]) {
            [plugin notifyListeners:name data:result];
        }
    });
    return YES;
}

BOOL PackingCallbacksNotifyOwner(NSString *owner, NSString *event, NSData *json) {
    return PackingNotifyOwner(owner, nil, event, json);
}

BOOL PackingCallbacksNotifyOwnerForEpoch(NSString *owner, NSString *epoch, NSString *event, NSData *json) {
    return PackingNotifyOwner(owner, epoch, event, json);
}

NSString *PackingCallbacksRegister(CAPPluginCall *call, dispatch_queue_t sdkQueue, NSString *owner) {
    dispatch_assert_queue(sdkQueue);
    if (owner.length == 0 || call.keepAlive) { return nil; }
    PackingInitialize();
    [PackingTableLock lock];
    if (PackingOwners[owner].resetting) { [PackingTableLock unlock]; return nil; }
    NSUInteger owned = 0;
    for (PackingCallbackEntry *entry in PackingTable.allValues) {
        if ([entry.owner isEqualToString:owner]) { owned++; }
    }
    if (PackingTable.count >= 64 || owned >= 16) {
        [PackingTableLock unlock];
        return nil;
    }
    NSString *token = NSUUID.UUID.UUIDString;
    while (PackingTable[token] != nil) { token = NSUUID.UUID.UUIDString; }
    PackingCallbackEntry *entry = [[PackingCallbackEntry alloc] init];
    entry.call = call;
    entry.queue = sdkQueue;
    entry.owner = owner;
    entry.epoch = PackingOwners[owner].epoch;
    PackingTable[token] = entry;
    [PackingTableLock unlock];
    return token;
}

static PackingCallbackEntry *PackingClaim(NSString *token) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackEntry *entry = PackingTable[token];
    if (entry.claimed) {
        entry = nil;
    } else {
        entry.claimed = YES;
    }
    [PackingTableLock unlock];
    return entry;
}

BOOL PackingCallbacksIsPending(NSString *token) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackEntry *entry = PackingTable[token];
    BOOL pending = entry != nil && !entry.claimed && !entry.cancelled;
    [PackingTableLock unlock];
    return pending;
}

BOOL PackingCallbacksSetDeliveryGuard(NSString *token, PackingCallbackDeliveryGuard guard,
                                      NSString *failureMessage, NSString *failureCode) {
    PackingInitialize();
    [PackingTableLock lock];
    PackingCallbackEntry *entry = PackingTable[token];
    BOOL accepted = entry != nil && !entry.claimed && !entry.cancelled;
    if (accepted) {
        entry.deliveryGuard = guard;
        entry.guardFailureMessage = failureMessage;
        entry.guardFailureCode = failureCode;
    }
    [PackingTableLock unlock];
    return accepted;
}

static void PackingApplyDeliveryGuard(PackingCallbackEntry *entry, dispatch_block_t response) {
    dispatch_assert_queue(entry.queue);
    // Guard fields become immutable when the terminal response is claimed.
    // Do not hold the registry lock while acquiring an authority lock/calling SDK.
    __block BOOL invoked = NO;
    __block BOOL closed = NO;
    dispatch_block_t once = ^{
        dispatch_assert_queue(entry.queue);
        if (closed || invoked) { return; }
        invoked = YES;
        response();
    };
    if (entry.deliveryGuard != nil) { entry.deliveryGuard(once); } else { once(); }
    closed = YES;
    if (!invoked) { [entry.call reject:entry.guardFailureMessage :entry.guardFailureCode :nil :nil]; }
}

static BOOL PackingDeliverCancellation(NSString *token, PackingCallbackEntry *entry) {
    dispatch_assert_queue(entry.queue);
    [PackingTableLock lock];
    BOOL cancelled = entry.cancelled;
    NSString *message = entry.cancellationMessage;
    NSString *code = entry.cancellationCode;
    // A reset changes the epoch before its revoker and old-epoch cancellation
    // run. Check here under the same lock so an unguarded old reply cannot
    // escape through that interval. Nil epochs are legacy unbound owners.
    if (!cancelled && entry.epoch != nil &&
        ![PackingOwners[entry.owner].epoch isEqualToString:entry.epoch]) {
        cancelled = YES;
        message = @"The capture selection changed. Reload the workspace.";
        code = @"STORAGE_CHANGED";
    }
    [PackingTable removeObjectForKey:token];
    [PackingTableLock unlock];
    if (cancelled) { [entry.call reject:message :code :nil :nil]; }
    return cancelled;
}

BOOL PackingCallbacksResolveNil(NSString *token) {
    PackingCallbackEntry *entry = PackingClaim(token);
    if (entry == nil) { return NO; }
    dispatch_async(entry.queue, ^{
        dispatch_assert_queue(entry.queue);
        if (PackingDeliverCancellation(token, entry)) { return; }
        PackingApplyDeliveryGuard(entry, ^{ [entry.call resolve]; });
    });
    return YES;
}

BOOL PackingCallbacksResolveJSON(NSString *token, NSData *json) {
    // Freeze caller-owned mutable NSData before crossing the queue boundary.
    NSData *payload = [json copy];
    PackingCallbackEntry *entry = PackingClaim(token);
    if (entry == nil) { return NO; }
    dispatch_async(entry.queue, ^{
        dispatch_assert_queue(entry.queue);
        if (PackingDeliverCancellation(token, entry)) { return; }
        PackingApplyDeliveryGuard(entry, ^{
            NSError *error = nil;
            id result = [NSJSONSerialization JSONObjectWithData:payload options:0 error:&error];
            if (error != nil || ![result isKindOfClass:NSDictionary.class]) {
                [entry.call reject:@"The native response could not be encoded." :@"NATIVE_RESPONSE_INVALID" :nil :nil];
                return;
            }
            [entry.call resolve:result];
        });
    });
    return YES;
}

BOOL PackingCallbacksReject(NSString *token, NSString *message, NSString *code) {
    NSString *frozenMessage = [message copy];
    NSString *frozenCode = [code copy];
    PackingCallbackEntry *entry = PackingClaim(token);
    if (entry == nil) { return NO; }
    dispatch_async(entry.queue, ^{
        dispatch_assert_queue(entry.queue);
        if (PackingDeliverCancellation(token, entry)) { return; }
        [entry.call reject:frozenMessage :frozenCode :nil :nil];
    });
    return YES;
}

static NSUInteger PackingCancelMatching(NSString *owner, NSString *message, NSString *code, NSString *epoch, BOOL restricted) {
    PackingInitialize();
    NSString *frozenMessage = [message copy];
    NSString *frozenCode = [code copy];
    NSMutableDictionary<NSString *, PackingCallbackEntry *> *schedule = [[NSMutableDictionary alloc] init];
    NSUInteger cancelled = 0;
    [PackingTableLock lock];
    for (NSString *token in PackingTable.allKeys) {
        PackingCallbackEntry *entry = PackingTable[token];
        if ([entry.owner isEqualToString:owner] && !entry.cancelled && (!restricted || entry.epoch == epoch || [entry.epoch isEqualToString:epoch])) {
            cancelled++;
            entry.cancelled = YES;
            entry.cancellationMessage = frozenMessage;
            entry.cancellationCode = frozenCode;
            if (!entry.claimed) {
                entry.claimed = YES;
                schedule[token] = entry;
            }
        }
    }
    [PackingTableLock unlock];
    for (NSString *token in schedule) {
        PackingCallbackEntry *entry = schedule[token];
        dispatch_async(entry.queue, ^{
            dispatch_assert_queue(entry.queue);
            PackingDeliverCancellation(token, entry);
        });
    }
    return cancelled;
}

static NSUInteger PackingCancelEpoch(NSString *owner, NSString *epoch, NSString *message, NSString *code) {
    return PackingCancelMatching(owner, message, code, epoch, YES);
}

NSUInteger PackingCallbacksCancelOwner(NSString *owner, NSString *message, NSString *code) {
    return PackingCancelMatching(owner, message, code, nil, NO);
}

NSUInteger PackingCallbacksPendingForOwner(NSString *owner) {
    PackingInitialize();
    [PackingTableLock lock];
    NSUInteger count = 0;
    for (PackingCallbackEntry *entry in PackingTable.allValues) {
        if ([entry.owner isEqualToString:owner]) { count++; }
    }
    [PackingTableLock unlock];
    return count;
}
