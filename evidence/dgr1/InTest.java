// Does the engine the IG Publisher uses actually fail on `in` with a multi-item left
// operand? The FHIRPath specification says an exception is thrown, but the claim that
// this is what blocks dgr-1 should rest on the implementation, not on the prose.
//
// Run with publisher-2.3.4.jar on the classpath — the same jar the audit builds with,
// so this is the same FHIRPathEngine that produced the errors.
import org.hl7.fhir.r5.context.SimpleWorkerContext;
import org.hl7.fhir.r5.fhirpath.FHIRPathEngine;
import org.hl7.fhir.r5.model.Patient;
import org.hl7.fhir.utilities.npm.NpmPackage;

public class InTest {
  static FHIRPathEngine engine;

  static void probe(String label, String expr) {
    System.out.println("  expression : " + expr);
    try {
      var result = engine.evaluate(new Patient(), expr);
      String value = result.isEmpty() ? "{ } (empty)"
          : result.size() == 1 ? result.get(0).primitiveValue()
          : result.size() + " items";
      System.out.println("  " + label + " -> " + value);
    } catch (Throwable t) {
      System.out.println("  " + label + " -> THREW " + t.getClass().getSimpleName()
          + ": " + String.valueOf(t.getMessage()).replace('\n', ' '));
    }
    System.out.println();
  }

  public static void main(String[] args) throws Exception {
    // An empty context is enough: every expression below is literal-only, so the
    // engine never consults definitions. Loading the core package is not needed and
    // trips over a duplicate-canonical check unrelated to this test.
    var ctx = new SimpleWorkerContext.SimpleWorkerContextBuilder().build();
    engine = new FHIRPathEngine(ctx);
    System.out.println();

    System.out.println("== `in` with a SINGLE item on the left (the documented case)");
    probe("single", "1 in (1 | 2 | 3)");

    System.out.println("== `in` with MULTIPLE items on the left (what dgr-1 produces)");
    probe("multi", "(1 | 2) in (1 | 2 | 3)");

    System.out.println("== `in` with an EMPTY left operand (the other dgr-1 case)");
    probe("empty", "{} in (1 | 2 | 3)");

    System.out.println("== the same test wrapped the way R6 rewrote dgr-1");
    probe("R6 .all()", "(1 | 2).all($this in (1 | 2 | 3))");

    System.out.println("== subsetOf — the operator dgr-1's human description describes");
    probe("subsetOf", "(1 | 2).subsetOf(1 | 2 | 3)");

    System.out.println("== a whole constraint shaped like R5 dgr-1, left side multi-item");
    probe("R5 shape", "true implies ((1 | 2) in (1 | 2 | 3))");

    System.out.println("== a whole constraint shaped like R5 dgr-1, left side empty");
    probe("R5 shape/empty", "true implies ({} in (1 | 2 | 3))");
  }
}
