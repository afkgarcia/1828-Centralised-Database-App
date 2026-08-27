plugins {
    kotlin("jvm") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
    application
    id("org.openjfx.javafxplugin") version "0.1.0"
}

group = "nl.eighteen28"
version = "0.9.0"

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(17))
    }
}

kotlin {
    jvmToolchain(17)
}

javafx {
    version = "21.0.2"
    modules = listOf("javafx.controls")
}

dependencies {
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3")
    implementation("org.apache.poi:poi:5.2.5")
    implementation("org.apache.poi:poi-ooxml:5.2.5")
    // POI runtime
    implementation("org.apache.logging.log4j:log4j-core:2.22.1")
    implementation("org.apache.logging.log4j:log4j-api:2.22.1")
    // Email notifications (real SMTP when configured; otherwise in-app outbox + .eml files)
    implementation("jakarta.mail:jakarta.mail-api:2.1.3")
    implementation("org.eclipse.angus:angus-mail:2.0.3")
}

application {
    mainClass.set("app.MainKt")
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = "app.MainKt"
    }
}

// Smoke check: runs the access-control logic end-to-end without launching JavaFX.
tasks.register<JavaExec>("accessCheck") {
    group = "verification"
    description = "Runs the access/auth/approval sanity check (no UI)."
    classpath = sourceSets["main"].runtimeClasspath + sourceSets["test"].output
    mainClass.set("app.AccessCheckKt")
}

sourceSets["test"].kotlin.srcDir("src/test/kotlin")
