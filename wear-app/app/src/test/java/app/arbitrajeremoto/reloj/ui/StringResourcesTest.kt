package app.arbitrajeremoto.reloj.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Every text exists in English (default) and Spanish, with the same placeholders. */
class StringResourcesTest {
    private fun strings(dir: String): Map<String, String> {
        val file = listOf(File("src/main/res/$dir/strings.xml"), File("app/src/main/res/$dir/strings.xml")).first { it.exists() }
        return Regex("""<string name="([a-z0-9_]+)"[^>]*>(.*?)</string>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(file.readText())
            .associate { it.groupValues[1] to it.groupValues[2] }
    }

    @Test
    fun `english and spanish have the same keys and placeholders`() {
        val en = strings("values")
        val es = strings("values-es")
        assertTrue(en.isNotEmpty())
        assertEquals(en.keys, es.keys)
        val placeholder = Regex("""%\d\$[sd]""")
        for (key in en.keys) {
            assertEquals(key, placeholder.findAll(en[key]!!).map { it.value }.toSet(), placeholder.findAll(es[key]!!).map { it.value }.toSet())
        }
    }
}
