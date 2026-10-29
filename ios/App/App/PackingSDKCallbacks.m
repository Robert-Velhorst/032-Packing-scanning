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
// All terminal/cancellation metadata below is protected by PackingTableLock.
@property(nonatomic) BOOL claimed;
@property(nonatomic) BOOL cancelled;
@property(nonatomic, copy) NSString *cancellationMessage;
@property(nonatomic, copy) NSString *cancellationCode;
@end
@implementation PackingCallbackEntry
@end

static NSLock *PackingTableLock;
static NSMutableDictionary<NSString *, PackingCallbackEntry *> *PackingTable;

static void PackingInitialize(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        PackingTableLock = [[NSLock alloc] init];
        PackingTable = [[NSMutableDictionary alloc] init];
    });
}

NSString *PackingCallbacksRegister(CAPPluginCall *call, dispatch_queue_t sdkQueue, NSString *owner) {
    dispatch_assert_queue(sdkQueue);
    if (owner.length == 0 || call.keepAlive) { return nil; }
    PackingInitialize();
    [PackingTableLock lock];
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

static BOOL PackingDeliverCancellation(NSString *token, PackingCallbackEntry *entry) {
    dispatch_assert_queue(entry.queue);
    [PackingTableLock lock];
    BOOL cancelled = entry.cancelled;
    NSString *message = entry.cancellationMessage;
    NSString *code = entry.cancellationCode;
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
        [entry.call resolve];
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
        NSError *error = nil;
        id result = [NSJSONSerialization JSONObjectWithData:payload options:0 error:&error];
        if (error != nil || ![result isKindOfClass:NSDictionary.class]) {
            [entry.call reject:@"The native response could not be encoded." :@"NATIVE_RESPONSE_INVALID" :nil :nil];
            return;
        }
        [entry.call resolve:result];
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

NSUInteger PackingCallbacksCancelOwner(NSString *owner, NSString *message, NSString *code) {
    PackingInitialize();
    NSString *frozenMessage = [message copy];
    NSString *frozenCode = [code copy];
    NSMutableDictionary<NSString *, PackingCallbackEntry *> *schedule = [[NSMutableDictionary alloc] init];
    NSUInteger cancelled = 0;
    [PackingTableLock lock];
    for (NSString *token in PackingTable.allKeys) {
        PackingCallbackEntry *entry = PackingTable[token];
        if ([entry.owner isEqualToString:owner] && !entry.cancelled) {
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
