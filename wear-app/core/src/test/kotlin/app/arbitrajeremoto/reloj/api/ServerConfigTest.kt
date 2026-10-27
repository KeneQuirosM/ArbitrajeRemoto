package app.arbitrajeremoto.reloj.api

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerConfigTest {
    @Test
    fun `only https, except http when allowed (debug)`() {
        assertEquals(ServerConfig.DEFAULT_BASE_URL, ServerConfig.normalizeBaseUrl(ServerConfig.DEFAULT_BASE_URL + "/", allowHttp = false))
        assertNull(ServerConfig.normalizeBaseUrl("http://localhost:8787/api/v1", allowHttp = false))
        assertEquals("http://localhost:8787/api/v1", ServerConfig.normalizeBaseUrl(" http://localhost:8787/api/v1/ ", allowHttp = true))
        assertNull(ServerConfig.normalizeBaseUrl("ftp://x.test", allowHttp = true))
        assertNull(ServerConfig.normalizeBaseUrl("https://", allowHttp = false))
        assertNull(ServerConfig.normalizeBaseUrl("https://user:pw@x.test/api/v1", allowHttp = false))
        assertNull(ServerConfig.normalizeBaseUrl("not a url", allowHttp = true))
    }

    @Test
    fun `device ids follow the server rules`() {
        val id = ServerConfig.newDeviceId()
        assertTrue(id.startsWith("watch-"))
        assertTrue(ServerConfig.isValidDeviceId(id))
        assertEquals(42, id.length)
        assertTrue(!ServerConfig.isValidDeviceId("watch 1") && !ServerConfig.isValidDeviceId("x".repeat(65)))
    }
}
