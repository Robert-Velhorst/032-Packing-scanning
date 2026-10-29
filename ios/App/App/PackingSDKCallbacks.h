#import <Foundation/Foundation.h>
#import <dispatch/dispatch.h>

@class CAPPluginCall;
@class CAPPlugin;

NS_ASSUME_NONNULL_BEGIN

// The guard must synchronously invoke action on the SDK queue, or omit it.
// It must not retain action. A missing invocation rejects the stale response.
typedef void (^PackingCallbackDeliveryGuard)(dispatch_block_t action);
FOUNDATION_EXPORT BOOL PackingCallbacksSetDeliveryGuard(NSString *token,
    PackingCallbackDeliveryGuard guard, NSString *failureMessage, NSString * _Nullable failureCode);

// SDK owner binding is weak; actor code exchanges only its immutable owner ID.
FOUNDATION_EXPORT BOOL PackingCallbacksBindOwner(CAPPlugin *plugin, dispatch_queue_t sdkQueue, NSString *owner);
FOUNDATION_EXPORT BOOL PackingCallbacksSetOwnerRevocation(NSString *owner, dispatch_block_t revoke);
FOUNDATION_EXPORT void PackingCallbacksUnbindOwner(NSString *owner, NSString *message, NSString * _Nullable code);
FOUNDATION_EXPORT BOOL PackingCallbacksNotifyOwner(NSString *owner, NSString *event, NSData *json);

// Promise calls only. Registration must run on the actual SDK serial queue.
// A nil result leaves the call with its caller; no callback is invoked.
FOUNDATION_EXPORT NSString * _Nullable PackingCallbacksRegister(
    CAPPluginCall *call, dispatch_queue_t sdkQueue, NSString *owner);

// Only immutable token/JSON bytes cross the UI boundary. The first terminal
// operation claims the callback; later operations are harmless and return NO.
// Owner cancellation can still override a claimed response until delivery begins.
// Claimed responses continue to count toward the64/global and16/owner limits.
FOUNDATION_EXPORT BOOL PackingCallbacksResolveNil(NSString *token);
FOUNDATION_EXPORT BOOL PackingCallbacksResolveJSON(NSString *token, NSData *json);
FOUNDATION_EXPORT BOOL PackingCallbacksReject(NSString *token, NSString *message,
                                             NSString * _Nullable code);
// Metadata query only: no SDK object is read outside its queue. False after a
// terminal claim or cancellation, including while delivery is still queued.
FOUNDATION_EXPORT BOOL PackingCallbacksIsPending(NSString *token);
FOUNDATION_EXPORT NSUInteger PackingCallbacksCancelOwner(
    NSString *owner, NSString *message, NSString * _Nullable code);
FOUNDATION_EXPORT NSUInteger PackingCallbacksPendingForOwner(NSString *owner);

NS_ASSUME_NONNULL_END
