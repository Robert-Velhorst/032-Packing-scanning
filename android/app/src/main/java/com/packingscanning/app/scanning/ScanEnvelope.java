package com.packingscanning.app.scanning;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/** Pure geometry: candidate orientations, full-cloud containment and explicit sampling margin. */
public final class ScanEnvelope {
    public static final String METHOD = "oriented_surface_envelope_v1";
    private final double[][] axes;
    private final double[] origin, rawSides;
    public final double[] dimensionsMm;
    public final String basis;
    public final double paddingMm;

    private ScanEnvelope(List<double[]> points, double[][] orientation, double padding, String basis) {
        this.axes = copy(orientation);
        this.basis = basis;
        this.paddingMm = padding * 1000;
        double[][] ranges = ranges(points, axes);
        final double[][] initialRanges=ranges;
        // Name packing axes by descending envelope side length; no gravity is inferred.
        Integer[] order = {0,1,2};
        Arrays.sort(order, Comparator.<Integer>comparingDouble(i -> -(initialRanges[1][i]-initialRanges[0][i])).thenComparingInt(i -> i));
        double[][] sorted = new double[3][];
        for (int i=0;i<3;i++) sorted[i]=axes[order[i]].clone();
        if (dot(cross(sorted[0],sorted[1]),sorted[2])<0) for(int i=0;i<3;i++) sorted[2][i]=-sorted[2][i];
        for(int i=0;i<3;i++) axes[i]=sorted[i];
        ranges=ranges(points,axes);
        rawSides=new double[3]; dimensionsMm=new double[3]; origin=new double[3];
        for(int i=0;i<3;i++) {
            rawSides[i]=ranges[1][i]-ranges[0][i]; dimensionsMm[i]=(rawSides[i]+2*padding)*1000;
            for(int j=0;j<3;j++) origin[j]+=axes[i][j]*(ranges[0][i]-padding);
        }
    }

    public static ScanEnvelope fit(List<float[]> input, double paddingMetres) {
        List<double[]> points=validatedSorted(input);
        if(!Double.isFinite(paddingMetres)||paddingMetres<0||paddingMetres>0.05) throw new IllegalArgumentException("Invalid sampling margin.");
        double[][] principal=principalAxes(points);
        double[][] principalRanges=ranges(points,principal);
        for(int i=0;i<3;i++) if(principalRanges[1][i]-principalRanges[0][i]<0.005) {
            throw new IllegalStateException("A side is missing or too thin for this depth scan. Capture more angles or measure it manually.");
        }
        ScanEnvelope best=new ScanEnvelope(points,identity(),paddingMetres,"capture_aligned");
        ScanEnvelope pca=new ScanEnvelope(points,principal,paddingMetres,"principal_components");
        if(pca.volume()<best.volume()*(1-1e-8)) best=pca;
        // Symmetric objects do not have a unique PCA orientation. Search a bounded
        // set using a deterministic sample, then bound EVERY original point.
        List<double[]> sample=new ArrayList<>();
        int count=Math.min(points.size(),1200);
        for(int i=0;i<count;i++) sample.add(points.get((int)((long)i*(points.size()-1)/Math.max(1,count-1))));
        double[] angles={0,0,0}; double sampleBest=Double.POSITIVE_INFINITY;
        for(int a=0;a<6;a++) for(int b=0;b<6;b++) for(int c=0;c<6;c++) {
            double[] candidate={a*Math.PI/12,b*Math.PI/12,c*Math.PI/12};
            double v=rangeVolume(sample,rotation(candidate));
            if(v<sampleBest*(1-1e-10)) {sampleBest=v;angles=candidate;}
        }
        for(double step:new double[]{Math.PI/36,Math.PI/180,Math.PI/900}) {
            double[] centre=angles.clone();
            for(int a=-2;a<=2;a++) for(int b=-2;b<=2;b++) for(int c=-2;c<=2;c++) {
                double[] candidate={centre[0]+a*step,centre[1]+b*step,centre[2]+c*step};
                double v=rangeVolume(sample,rotation(candidate));
                if(v<sampleBest*(1-1e-10)) {sampleBest=v;angles=candidate;}
            }
        }
        ScanEnvelope searched=new ScanEnvelope(points,rotation(angles),paddingMetres,"orientation_search");
        if(searched.volume()<best.volume()*(1-1e-8)) best=searched;
        return best;
    }

    public static ScanEnvelope captureAligned(List<float[]> input) {
        return new ScanEnvelope(validatedSorted(input),identity(),0,"capture_aligned_legacy");
    }
    public double[] projectMm(float[] point) {
        double[] offset={point[0]-origin[0],point[1]-origin[1],point[2]-origin[2]};
        return new double[]{dot(offset,axes[0])*1000,dot(offset,axes[1])*1000,dot(offset,axes[2])*1000};
    }
    public double[] rawDimensionsMm() {return new double[]{rawSides[0]*1000,rawSides[1]*1000,rawSides[2]*1000};}
    public double[][] axes() {return copy(axes);}
    public double[] originMetres() {return origin.clone();}
    private double volume() {return dimensionsMm[0]*dimensionsMm[1]*dimensionsMm[2];}
    private static List<double[]> validatedSorted(List<float[]> input) {
        if(input==null||input.size()<4||input.size()>DepthCloud.MAX_POINTS) throw new IllegalArgumentException("Invalid point cloud size.");
        List<double[]> points=new ArrayList<>(input.size());
        for(float[] p:input) {
            if(p==null||p.length<3||!Float.isFinite(p[0])||!Float.isFinite(p[1])||!Float.isFinite(p[2])) throw new IllegalArgumentException("Invalid captured point.");
            points.add(new double[]{p[0],p[1],p[2]});
        }
        points.sort(Comparator.<double[]>comparingDouble(p->p[0]).thenComparingDouble(p->p[1]).thenComparingDouble(p->p[2]));
        return points;
    }
    private static double[][] principalAxes(List<double[]> points) {
        double[] mean=new double[3];
        for(double[] p:points) for(int i=0;i<3;i++) mean[i]+=p[i]/points.size();
        double[][] covariance=new double[3][3];
        for(double[] p:points) for(int i=0;i<3;i++) for(int j=i;j<3;j++) covariance[i][j]+=(p[i]-mean[i])*(p[j]-mean[j])/points.size();
        for(int i=0;i<3;i++) for(int j=0;j<i;j++) covariance[i][j]=covariance[j][i];
        double[][] vectors=identity();
        for(int iteration=0;iteration<40;iteration++) {
            int p=0,q=1;
            for(int i=0;i<3;i++) for(int j=i+1;j<3;j++) if(Math.abs(covariance[i][j])>Math.abs(covariance[p][q])) {p=i;q=j;}
            if(Math.abs(covariance[p][q])<1e-14) break;
            double angle=0.5*Math.atan2(2*covariance[p][q],covariance[q][q]-covariance[p][p]);
            double c=Math.cos(angle),s=Math.sin(angle);
            double pp=covariance[p][p],qq=covariance[q][q],pq=covariance[p][q];
            covariance[p][p]=c*c*pp-2*s*c*pq+s*s*qq;
            covariance[q][q]=s*s*pp+2*s*c*pq+c*c*qq;
            covariance[p][q]=covariance[q][p]=0;
            for(int k=0;k<3;k++) if(k!=p&&k!=q) {
                double kp=covariance[k][p],kq=covariance[k][q];
                covariance[k][p]=covariance[p][k]=c*kp-s*kq;
                covariance[k][q]=covariance[q][k]=s*kp+c*kq;
            }
            for(int k=0;k<3;k++) {double kp=vectors[k][p],kq=vectors[k][q];vectors[k][p]=c*kp-s*kq;vectors[k][q]=s*kp+c*kq;}
        }
        double[][] axes=new double[3][3];
        for(int i=0;i<3;i++) for(int j=0;j<3;j++) axes[i][j]=vectors[j][i];
        return axes;
    }
    private static double[][] rotation(double[] angles) {
        double x=angles[0],y=angles[1],z=angles[2],cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
        return new double[][]{{cz*cy,sz*cy,-sy},{cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx},{cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx}};
    }
    private static double[][] ranges(List<double[]> points,double[][] axes) {
        double[][] result={{Double.POSITIVE_INFINITY,Double.POSITIVE_INFINITY,Double.POSITIVE_INFINITY},{Double.NEGATIVE_INFINITY,Double.NEGATIVE_INFINITY,Double.NEGATIVE_INFINITY}};
        for(double[] point:points) for(int i=0;i<3;i++) {double v=dot(point,axes[i]);result[0][i]=Math.min(result[0][i],v);result[1][i]=Math.max(result[1][i],v);}
        return result;
    }
    private static double rangeVolume(List<double[]> points,double[][] axes) {double[][] r=ranges(points,axes);return (r[1][0]-r[0][0])*(r[1][1]-r[0][1])*(r[1][2]-r[0][2]);}
    private static double[][] identity(){return new double[][]{{1,0,0},{0,1,0},{0,0,1}};}
    private static double[][] copy(double[][] value){return new double[][]{value[0].clone(),value[1].clone(),value[2].clone()};}
    private static double dot(double[] a,double[] b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
    private static double[] cross(double[] a,double[] b){return new double[]{a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]};}
}
