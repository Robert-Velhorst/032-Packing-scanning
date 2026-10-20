import com.packingscanning.app.scanning.ScanEnvelope;
import java.io.BufferedReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

/** Independently run the actual Android implementation against Swift's synthetic fixtures. */
public final class CheckIosEnvelope {
    public static void main(String[] args) throws Exception {
        try (BufferedReader reader = Files.newBufferedReader(Path.of(args[0]))) {
            if (!"packing-envelope-parity-v1".equals(reader.readLine())) throw new AssertionError("Fixture version");
            int count = Integer.parseInt(reader.readLine());
            for (int fixture = 0; fixture < count; fixture++) {
                String[] header = reader.readLine().split(" ");
                int vertices = Integer.parseInt(header[0]);
                String[] dimensions = reader.readLine().split(" ");
                List<float[]> points = new ArrayList<>();
                for (int index = 0; index < vertices; index++) {
                    String[] values = reader.readLine().split(" ");
                    points.add(new float[]{Float.parseFloat(values[0]), Float.parseFloat(values[1]), Float.parseFloat(values[2]), 1});
                }
                ScanEnvelope envelope = ScanEnvelope.fit(points, 0.0025);
                if (!envelope.basis.equals(header[1])) throw new AssertionError("Native orientation basis differs in fixture " + fixture);
                for (int axis = 0; axis < 3; axis++) {
                    if (Math.abs(envelope.dimensionsMm[axis] - Double.parseDouble(dimensions[axis])) > 0.005)
                        throw new AssertionError("Native dimensions differ in fixture " + fixture + " axis " + axis);
                }
            }
            if (reader.readLine() != null) throw new AssertionError("Unexpected fixture data");
            System.out.println("Android/iOS envelope parity passed for " + count + " native float-source fixtures (0.005 mm tolerance).");
        }
    }
}
