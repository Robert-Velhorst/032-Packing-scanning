import com.packingscanning.app.scanning.VoxelCavity;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Scanner;

public final class CheckIosVoxelCavity {
    private static int[] cells(Scanner input) {
        int[] result=new int[input.nextInt()];for(int i=0;i<result.length;i++)result[i]=input.nextInt();return result;
    }
    public static void main(String[] args) throws Exception {
        int count=0;
        try(Scanner input=new Scanner(Files.newBufferedReader(Path.of(args[0]))).useLocale(Locale.ROOT)) {
            while(input.hasNext()) {
                String name=input.next();int n=input.nextInt(),accepted=input.nextInt();
                double[] bounds={input.nextDouble(),input.nextDouble(),input.nextDouble()};
                int axis=input.nextInt(),sign=input.nextInt();double[] seed={input.nextDouble(),input.nextDouble(),input.nextDouble()};
                int nx=0,ny=0,nz=0,faces=0;double volume=0;int[] free=null,opening=null,observed=null;
                if(accepted==1) {
                    nx=input.nextInt();ny=input.nextInt();nz=input.nextInt();faces=input.nextInt();volume=input.nextDouble();
                    free=cells(input);opening=cells(input);observed=cells(input);
                }
                List<double[]> points=new ArrayList<>();
                for(int i=0;i<n;i++)points.add(new double[]{input.nextDouble(),input.nextDouble(),input.nextDouble()});
                VoxelCavity cavity;
                try {cavity=VoxelCavity.reconstruct(points,bounds,axis,sign,seed);}
                catch(VoxelCavity.ReconstructionRejected rejected) {
                    if(accepted==1)throw new AssertionError(name+": Android rejected Swift result",rejected);
                    count++;continue;
                }
                if(accepted!=1||cavity.nx!=nx||cavity.ny!=ny||cavity.nz!=nz||cavity.surfaceFaceCount!=faces
                    ||Math.abs(cavity.estimatedVolumeMm3-volume)>1e-6||!Arrays.equals(free,cavity.freeCells)
                    ||!Arrays.equals(opening,cavity.openingCells)||!Arrays.equals(observed,cavity.observedCells))
                    throw new AssertionError(name+": cavity providers disagree");
                count++;
            }
        }
        if(count!=18)throw new AssertionError("Expected eighteen cavity fixtures, received "+count);
        System.out.println("Swift/Android cavity parity passed for "+count+" sources");
    }
}
