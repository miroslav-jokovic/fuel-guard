package expo.modules.capturenative

import expo.modules.kotlin.exception.CodedException

/** A CodedException whose `code` reaches JS (mapped to the engine's RejectionReason taxonomy). */
internal class CodedScannerException(code: String, message: String) : CodedException(code, message, null)
