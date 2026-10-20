# iOS app API privacy declarations

The app-level `PrivacyInfo.xcprivacy` declares the required-reason APIs currently
used by its own native source. It is copied into the app bundle, and the build
helper compares the parsed source and packaged manifests for both unsigned SDK
builds.

| Category | Reason | Current native use |
| --- | --- | --- |
| File timestamp/metadata | C617.1 | App-container file type, size, link and inode checks for owned capture/pending files. |
| System boot time | 35F9.1 | In-app idle windows, capture deadlines and temporary-ticket expiry. Raw boot-clock values are not exported. |
| User defaults | CA92.1 | The app's own install marker for account-key cleanup. |

These reasons follow Apple's [required-reason API catalog](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitype)
and the [manifest requirements](https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api).
The provider layer must add the appropriate user-selected-file reason when it
starts accessing external document metadata. The pending core currently accesses
only its app-private directory.

This is an API-use declaration, not a completed App Store privacy questionnaire
or a claim that no data is collected. Optional account, sharing and weather
services, SDK declarations, signing and real distribution review still require
their own accurate release assessment. No entitlement or filesystem permission
is granted by this manifest.
