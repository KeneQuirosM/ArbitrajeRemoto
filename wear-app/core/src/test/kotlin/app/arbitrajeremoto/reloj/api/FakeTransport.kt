package app.arbitrajeremoto.reloj.api

import java.io.IOException

/** Scripted transport: answers in order and records every request. */
class FakeTransport(vararg responses: Any) : HttpTransport {
    private val queue = ArrayDeque(responses.toList())
    val requests = mutableListOf<HttpRequest>()

    fun enqueue(response: Any) = queue.addLast(response)

    override fun execute(request: HttpRequest): HttpResponse {
        requests += request
        return when (val next = queue.removeFirstOrNull() ?: error("No scripted response for $request")) {
            is HttpResponse -> next
            is IOException -> throw next
            is Responder -> next.respond(request)
            else -> error("Bad script item $next")
        }
    }
}

/** Dynamic answer, for responses that depend on the request. */
fun interface Responder {
    fun respond(request: HttpRequest): HttpResponse
}

fun json(status: Int, body: String, vararg headers: Pair<String, String>) =
    HttpResponse(status, headers.associate { it.first.lowercase() to it.second }, body)
