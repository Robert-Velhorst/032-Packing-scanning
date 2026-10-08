package com.packingscanning.app.scanning;

import org.junit.Test;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import static org.junit.Assert.*;

/** Version 1 analytic reference surfaces. These are not phone capture accuracy benchmarks. */
public class ScanEnvelopeTest {
    static List<float[]> box(double l,double w,double h,double rx,double ry,double rz) {
        List<float[]> points=new ArrayList<>();
        for(int x=0;x<=10;x++) for(int y=0;y<=10;y++) for(int z=0;z<=10;z++) {
            if(x!=0&&x!=10&&y!=0&&y!=10&&z!=0&&z!=10)continue;
            double a=(x/10.0-.5)*l,b=(y/10.0-.5)*w,c=(z/10.0-.5)*h;
            points.add(rotate(a,b,c,rx,ry,rz));
        }
        return points;
    }
    private static float[] rotate(double x,double y,double z,double rx,double ry,double rz) {
        double yy=y*Math.cos(rx)-z*Math.sin(rx),zz=y*Math.sin(rx)+z*Math.cos(rx);
        double xx=x*Math.cos(ry)+zz*Math.sin(ry);zz=-x*Math.sin(ry)+zz*Math.cos(ry);
        double bx=xx*Math.cos(rz)-yy*Math.sin(rz),by=xx*Math.sin(rz)+yy*Math.cos(rz);
        return new float[]{(float)bx,(float)by,(float)zz,0.9f};
    }
    private static void containsEveryPoint(ScanEnvelope envelope,List<float[]> points) {
        for(float[] p:points){double[] v=envelope.projectMm(p);for(int i=0;i<3;i++){assertTrue(v[i]>=envelope.paddingMm-0.00001);assertTrue(v[i]<=envelope.dimensionsMm[i]-envelope.paddingMm+0.00001);}}
    }
    @Test public void rotatedRigidBoxesUseTheirObjectEnvelopeInsteadOfPhoneAxes() {
        for(double[] angles:new double[][]{{0,0,Math.PI/4},{.37,-.22,.73},{-.21,.67,-.31}}) {
            List<float[]> points=box(.5,.3,.18,angles[0],angles[1],angles[2]);
            ScanEnvelope result=ScanEnvelope.fit(points,.0025);
            assertArrayEquals(new double[]{505,305,185},result.dimensionsMm,.01);
            containsEveryPoint(result,points);
            double cameraVolume=1;for(double side:ScanEnvelope.captureAligned(points).dimensionsMm)cameraVolume*=side+5;
            double volume=1;for(double side:result.dimensionsMm)volume*=side;
            assertTrue(volume<cameraVolume*.95);
        }
    }
    @Test public void isotropicCubeDoesNotDependOnAnUndefinedPcaOrientation() {
        List<float[]> points=box(.2,.2,.2,0,0,Math.PI/4);
        ScanEnvelope result=ScanEnvelope.fit(points,.0025);
        assertArrayEquals(new double[]{205,205,205},result.dimensionsMm,.01);
        containsEveryPoint(result,points);
    }
    @Test public void aCylinderRetainsItsFullDiameterAndEndCaps() {
        List<float[]> points=new ArrayList<>();
        for(int level=0;level<=10;level++)for(int angle=0;angle<180;angle++) {
            double t=angle*Math.PI/90;points.add(rotate(.1*Math.cos(t),.1*Math.sin(t),-.2+level*.04,.3,.2,.5));
        }
        ScanEnvelope result=ScanEnvelope.fit(points,.0025);
        assertArrayEquals(new double[]{405,205,205},result.dimensionsMm,.15);
        containsEveryPoint(result,points);
    }
    @Test public void hiddenConcavitiesAndHandlesAreNotTreatedAsFreePackingSpace() {
        List<float[]> points=box(.3,.16,.1,0,0,.4);
        points.add(new float[]{.23f,.02f,.01f,.9f}); // observed handle / possible clutter
        ScanEnvelope result=ScanEnvelope.fit(points,.0025);
        containsEveryPoint(result,points);
        assertTrue(result.dimensionsMm[0]>305);
    }
    @Test public void inputOrderAndTranslationDoNotChangeDimensions() {
        List<float[]> points=box(.4,.22,.12,.1,.2,.6);
        ScanEnvelope first=ScanEnvelope.fit(points,.0025);
        Collections.reverse(points);
        assertArrayEquals(first.dimensionsMm,ScanEnvelope.fit(points,.0025).dimensionsMm,0);
        for(float[] p:points){p[0]+=.08f;p[1]-=.12f;p[2]+=.03f;}
        assertArrayEquals(first.dimensionsMm,ScanEnvelope.fit(points,.0025).dimensionsMm,.01);
    }
    @Test public void tiltedSingleSurfaceAndMalformedCloudsAreRejected() {
        List<float[]> points=box(.3,.2,0,.3,.4,.2);
        assertThrows(IllegalStateException.class,()->ScanEnvelope.fit(points,.0025));
        points.get(0)[0]=Float.NaN;
        assertThrows(IllegalArgumentException.class,()->ScanEnvelope.fit(points,.0025));
        assertThrows(IllegalArgumentException.class,()->ScanEnvelope.fit(box(.3,.2,.1,0,0,0),Double.NaN));
    }
}
