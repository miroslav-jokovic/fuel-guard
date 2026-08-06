package expo.modules.capturenative

import android.app.Activity
import android.content.Context
import android.content.Intent
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import expo.modules.kotlin.activityresult.AppContextActivityResultContract
import java.io.Serializable

/** Serializable launch input — only a nonce (safe across process death); the IntentSender is held by the module. */
internal data class DocumentScannerInput(val nonce: Long) : Serializable

internal sealed class DocumentScannerResult {
  data class Success(val data: Intent?) : DocumentScannerResult()
  object Cancelled : DocumentScannerResult()
}

/**
 * Bridges the Play-Services document scanner's IntentSender into the Expo activity-result flow.
 *
 * The IntentSender is obtained asynchronously at scan time and is not Serializable, so the module holds it
 * transiently and this contract reads it via [requestSupplier] when it builds the launch intent — delegating
 * to AndroidX's own StartIntentSenderForResult so the intent wrapping matches the framework exactly. The
 * IntentSender is needed only at launch (createIntent), never on result restoration (parseResult), so the
 * Serializable [DocumentScannerInput] carrying just a nonce is sufficient for process-death survival.
 */
internal class DocumentScannerContract(
  private val requestSupplier: () -> IntentSenderRequest?,
) : AppContextActivityResultContract<DocumentScannerInput, DocumentScannerResult> {
  private val delegate = ActivityResultContracts.StartIntentSenderForResult()

  override fun createIntent(context: Context, input: DocumentScannerInput): Intent {
    val request = requestSupplier() ?: throw IllegalStateException("No pending document-scan request")
    return delegate.createIntent(context, request)
  }

  override fun parseResult(input: DocumentScannerInput, resultCode: Int, intent: Intent?): DocumentScannerResult =
    if (resultCode == Activity.RESULT_OK) DocumentScannerResult.Success(intent) else DocumentScannerResult.Cancelled
}
