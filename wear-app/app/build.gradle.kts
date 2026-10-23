plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.devtools.ksp")
}

ksp {
    // Room schema history, committed (the CI fails if a build changes it without a commit)
    arg("room.schemaLocation", "$projectDir/schemas")
}

android {
    namespace = "app.arbitrajeremoto.reloj"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.arbitrajeremoto.reloj"
        minSdk = 33 // Wear OS 4 (Galaxy Watch 4 runs Wear OS 5)
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "DEFAULT_BASE_URL", "\"https://arbitraje-remoto.vercel.app/api/v1\"")
        buildConfigField("boolean", "ALLOW_HTTP", "false")
    }

    signingConfigs {
        // Fixed, public debug key (password "android"): every debug APK, CI or local, has the same
        // signature and installs over the previous one with `adb install -r`. Never for release.
        getByName("debug") {
            storeFile = rootProject.file("keystore/debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }
    }

    buildTypes {
        debug {
            // Plain http only in debug, for a local API (see wear-app/README.md)
            buildConfigField("boolean", "ALLOW_HTTP", "true")
        }
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    implementation(project(":core"))

    // Compose for Wear OS
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.wear.compose:compose-material3:1.6.2")
    implementation("androidx.wear.compose:compose-foundation:1.6.2")
    implementation("androidx.wear.compose:compose-navigation:1.6.2")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")

    // Activity + Lifecycle
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")

    // Local matches, events and the send queue
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")

    // Background sending of the queue (CONNECTED constraint). 2.10.0: the stable line that still
    // depends on Room 2.6.1 (2.11 moves to Room 2.7 and would upgrade ours) and on lifecycle 2.6+
    implementation("androidx.work:work-runtime-ktx:2.10.0")

    // Settings and the encrypted deviceKey
    implementation("androidx.datastore:datastore-preferences:1.2.1")

    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("androidx.core:core-ktx:1.15.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("androidx.test:core:1.6.1")
}

// `./gradlew testDebugUnitTest` also runs the pure-Kotlin tests of :core (domain, client, pairing, sync)
tasks.matching { it.name == "testDebugUnitTest" }.configureEach { dependsOn(":core:test") }
