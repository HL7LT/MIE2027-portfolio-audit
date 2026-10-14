#!/usr/bin/env bash
# Reproduce the dgr-1 finding.
#
# dgr-1 is reported against all eight DiagnosticReports in the portfolio that carry a
# composition, and against none that passes — including three whose data is provably
# correct. The claim that this is a defect in the R5 invariant rather than in our data
# should not rest on reading the FHIRPath prose, so this evaluates the operator with the
# same engine, from the same jar, that produced the errors.
#
# Usage: bash run.sh   (writes output.txt)
set -eu
cd "$(dirname "$0")"
# Java is a native Windows binary: it needs Windows paths and ';' between classpath
# entries, not the POSIX forms Git Bash hands out.
win() { cygpath -m "$1" 2>/dev/null || echo "$1"; }
# The publisher jar is not shipped in this package. Pass its path as the first
# argument, or set PUBLISHER_JAR. Its SHA-256 is recorded in audit_manifest.json:
#   970922c12eb583bfb4cb6121584b922a236d5904e36413e3545d2fbc248f8e2b
JAR_IN="${1:-${PUBLISHER_JAR:-}}"
if [ -z "$JAR_IN" ] || [ ! -f "$JAR_IN" ]; then
  echo "usage: bash run.sh /path/to/publisher-2.3.4.jar" >&2
  echo "       (sha256 must be 970922c12eb583bfb4cb6121584b922a236d5904e36413e3545d2fbc248f8e2b)" >&2
  exit 2
fi
JAR="$(win "$JAR_IN")"
HERE="$(win "$PWD")"
JDK="${JAVA_HOME:-/c/Program Files/Eclipse Adoptium/jdk-21.0.11.10-hotspot}/bin"

"$JDK/javac" -nowarn -cp "$JAR" -d . InTest.java
"$JDK/java" -Xmx2g -cp "$JAR;$HERE" InTest 2>&1 | grep -v "SLF4J\|^WARNING" | tee output.txt
