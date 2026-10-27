package app.arbitrajeremoto.reloj.api

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** One HTTP request. [toString] never prints the Authorization header (it carries the deviceKey). */
class HttpRequest(
    val method: String,
    val url: String,
    val headers: Map<String, String> = emptyMap(),
    val body: String? = null,
) {
    override fun toString(): String = "HttpRequest($method $url)"
}

/** Response with lower-cased header names. */
class HttpResponse(
    val status: Int,
    val headers: Map<String, String>,
    val body: String,
) {
    fun header(name: String): String? = headers[name.lowercase()]
    override fun toString(): String = "HttpResponse($status)"
}

/** Network layer. Throws [IOException] for network errors and timeouts. */
fun interface HttpTransport {
    @Throws(IOException::class)
    fun execute(request: HttpRequest): HttpResponse
}

/**
 * Plain [HttpURLConnection]: it ships with Android and the JVM, so the same client runs on the watch,
 * in the unit tests and in the contract tests, with no extra library. The API needs nothing more
 * (JSON bodies, one header for auth, no cookies on the watch).
 */
class UrlConnectionTransport(private val timeoutMs: Int = DEFAULT_TIMEOUT_MS) : HttpTransport {

    override fun execute(request: HttpRequest): HttpResponse {
        val connection = URL(request.url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = timeoutMs
            connection.readTimeout = timeoutMs
            connection.instanceFollowRedirects = false
            connection.useCaches = false
            connection.requestMethod = request.method
            connection.setRequestProperty("Accept", "application/json")
            request.headers.forEach { (name, value) -> connection.setRequestProperty(name, value) }
            if (request.body != null) {
                val bytes = request.body.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setFixedLengthStreamingMode(bytes.size)
                connection.outputStream.use { it.write(bytes) }
            }
            val status = connection.responseCode
            val stream = if (status >= 400) connection.errorStream else connection.inputStream
            val body = stream?.use { it.readBytes().toString(Charsets.UTF_8) } ?: ""
            val headers = connection.headerFields
                .filterKeys { it != null }
                .mapKeys { it.key.lowercase() }
                .mapValues { it.value.joinToString(", ") }
            return HttpResponse(status, headers, body)
        } finally {
            connection.disconnect()
        }
    }

    companion object {
        /** Guide §3: the signal on the pitch is weak, 15 s per request. */
        const val DEFAULT_TIMEOUT_MS = 15_000
    }
}
