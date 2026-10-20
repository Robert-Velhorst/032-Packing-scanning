import com.packingscanning.app.scanning.VoxelSolid;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Scanner;

/** Execute Android's production implementation against the Swift-generated source and result. */
public final class CheckIosVoxelSolid {
    public static void main(String[] args) throws Exception {
        int count = 0;
        try (Scanner input = new Scanner(Files.newBufferedReader(Path.of(args[0]))).useLocale(Locale.ROOT)) {
            while (input.hasNext()) {
                String name = input.next(); int pointCount = input.nextInt(), accepted = input.nextInt();
                double[] bounds = {input.nextDouble(), input.nextDouble(), input.nextDouble()};
                int nx=0,ny=0,nz=0,observed=0,enclosed=0,faces=0; double resolution=0; int[] cells=null;
                if (accepted == 1) {
                    nx=input.nextInt();ny=input.nextInt();nz=input.nextInt();resolution=input.nextDouble();
                    observed=input.nextInt();enclosed=input.nextInt();faces=input.nextInt();
                    cells=new int[observed+enclosed];for(int i=0;i<cells.length;i++)cells[i]=input.nextInt();
                }
                List<double[]> points=new ArrayList<>();
                for(int i=0;i<pointCount;i++)points.add(new double[]{input.nextDouble(),input.nextDouble(),input.nextDouble()});
                VoxelSolid solid;
                try { solid=VoxelSolid.reconstruct(points,bounds); }
                catch(VoxelSolid.ReconstructionRejected rejected) {
                    if(accepted==1)throw new AssertionError(name+": Android rejected Swift's accepted source",rejected);
                    count++;continue;
                }
                if(accepted!=1||solid.nx!=nx||solid.ny!=ny||solid.nz!=nz||solid.resolutionMm!=resolution
                    ||solid.observedCellCount!=observed||solid.enclosedCellCount!=enclosed||solid.faceCount!=faces
                    ||!Arrays.equals(solid.occupiedCells,cells))throw new AssertionError(name+": native providers disagree");
                count++;
            }
        }
        if(count!=9)throw new AssertionError("Expected nine cross-provider fixtures, received "+count);
        System.out.println("Swift/Android voxel reconstruction parity passed for "+count+" sources");
    }
}
