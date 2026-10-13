package com.packingscanning.app.scanning;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedWriter;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.BufferedReader;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;
import java.util.List;
import java.util.ArrayList;
import java.util.Arrays;
import java.security.MessageDigest;
import java.security.DigestInputStream;

/** Private, UUID-addressed captures. No content provider, public path or upload operation. */
public final class CaptureStore {
    private static final String CAPTURE_ID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
    private final File root;
    private final CaptureScopeManager.Access access;
    interface Clock { long milliseconds(); }
    private final Clock clock;
    public static final int RETENTION_BATCH_SIZE = 100;

    /** Existing guest storage only. Protected callers must supply a revocable Access. */
    public CaptureStore(File filesDir) throws IOException {
        access = null;
        clock = System::currentTimeMillis;
        root = new File(filesDir,"packing-scans").getCanonicalFile();
        if(!filesDir.getCanonicalFile().equals(root.getParentFile())) throw new IOException("Invalid private capture root.");
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Private capture storage could not be prepared.");
    }

    public CaptureStore(File filesDir, CaptureScopeManager.Access access) throws IOException {
        this(filesDir,access,System::currentTimeMillis);
    }

    CaptureStore(File filesDir, CaptureScopeManager.Access access, Clock clock) throws IOException {
        if (access == null) throw new IOException("Choose a capture workspace first.");
        this.access = access;
        this.clock = clock;
        root = access.root(filesDir);
    }

    private void check() throws IOException {
        if (access != null) access.check();
        if (!root.equals(root.getCanonicalFile()) || !root.isDirectory()) throw new IOException("Invalid private capture storage.");
    }

    private <T> T checked(CaptureScopeManager.IoAction<T> action) throws IOException {
        if (access != null) return access.checked(() -> { check(); return action.run(); });
        check(); return action.run();
    }

    private JSONObject finish(JSONObject result) throws IOException { check(); return result; }

    private File folder(String id) throws IOException {
        check();
        if (id == null || !id.matches(CAPTURE_ID_PATTERN)) {
            throw new IOException("Invalid capture identifier.");
        }
        File folder = new File(root,UUID.fromString(id).toString()).getCanonicalFile();
        if (!root.equals(folder.getParentFile()) || !UUID.fromString(id).toString().equals(folder.getName())) throw new IOException("Invalid capture location.");
        return folder;
    }

    public JSONObject save(String target, DepthCloud.Snapshot snapshot) throws Exception {
        if (!"item".equals(target) && !"container_interior".equals(target)) throw new IOException("Invalid capture target.");
        if (snapshot == null || snapshot.points.size() < 4 || snapshot.points.size() > DepthCloud.MAX_POINTS) throw new IOException("Invalid capture point count.");
        String id = UUID.randomUUID().toString();
        File destination = folder(id);
        checked(() -> { if (!destination.mkdir()) throw new IOException("A private capture folder could not be created."); return null; });
        try {
            try (PlainBuffer buffer = new PlainBuffer(8000000)) {
                BufferedWriter out = new BufferedWriter(new OutputStreamWriter(buffer,StandardCharsets.UTF_8));
                out.write("ply\nformat ascii 1.0\ncomment units metres; capture-local right-handed camera frame\nelement vertex " + snapshot.points.size()
                    + "\nproperty float x\nproperty float y\nproperty float z\nproperty float confidence\nend_header\n");
                for (float[] point : snapshot.points) out.write(point[0] + " " + point[1] + " " + point[2] + " " + point[3] + "\n");
                out.flush();
                writeCapture(destination,id,"points.ply",buffer.toByteArray());
            }
            SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);
            format.setTimeZone(TimeZone.getTimeZone("UTC"));
            JSONObject record = new JSONObject().put("id",id).put("target",target).put("createdAt",format.format(new Date(clock.milliseconds())))
                .put("platform","android").put("method","arcore_depth").put("completedPasses",snapshot.views).put("modelStoredLocally",true)
                .put("geometry",new JSONObject().put("format","ply_point_cloud").put("units","metres").put("pointCount",snapshot.points.size()).put("coordinateFrame","capture_local_right_handed")
                    .put("envelope",new JSONObject().put("method",ScanEnvelope.METHOD).put("basis",snapshot.envelope.basis).put("paddingMm",snapshot.envelope.paddingMm)))
                .put("quality",new JSONObject().put("depthFrames",snapshot.frames).put("viewCount",snapshot.views).put("confidenceThreshold",0.8).put("voxelSizeMm",5));
            if(snapshot.guidance.freshFrames>0) {
                CaptureGuidance.Summary g=snapshot.guidance;
                record.getJSONObject("quality").put("coverage",new JSONObject().put("method",CaptureGuidance.METHOD)
                    .put("freshFrames",g.freshFrames).put("examinedPixels",g.examinedPixels).put("confidentPixels",g.confidentPixels)
                    .put("sideMask",g.sideMask).put("elevatedViews",g.elevatedViews).put("loweredViews",g.loweredViews));
            }
            JSONArray warnings = new JSONArray().put("Depth geometry is an estimate. Check all dimensions physically; this is not a watertight mesh or a closure guarantee.")
                .put("The capture area can include neighbouring objects and miss hidden surfaces. Restart if the preview includes background geometry.");
            if ("container_interior".equals(target)) warnings.put("The bounding box of visible interior surfaces is not the true usable cavity. Confirm the interior and narrowest opening manually.");
            warnings.put("The oriented envelope includes a 2.5 mm sampling margin on every face. This does not bound sensor error or hidden surfaces, and its sorted sides do not establish which side must remain upright.");
            if(snapshot.guidance.freshFrames>0)for(String warning:snapshot.guidance.warnings("item".equals(target)))warnings.put(warning);
            if (snapshot.capped) warnings.put("The capture reached its point limit; additional detail was omitted.");
            JSONObject result = new JSONObject().put("record",record).put("dimensionsMm",new JSONObject().put("length",snapshot.dimensionsMm[0]).put("width",snapshot.dimensionsMm[1]).put("height",snapshot.dimensionsMm[2])).put("warnings",warnings);
            writeCapture(destination,id,"capture.json",result.toString().getBytes(StandardCharsets.UTF_8));
            return finish(result);
        } catch (Exception error) { removeTree(destination); throw error; }
    }

    /** Read only this UUID's private source; never return a path, URI or original file. */
    private SourceGeometry readSource(String id) throws Exception {
        File capture=folder(id);
        byte[] metadata=readCapture(capture,id,"capture.json",20000);
        JSONObject stored;
        try { stored=new JSONObject(new String(metadata,StandardCharsets.UTF_8)); }
        finally { Arrays.fill(metadata,(byte)0); }
        JSONObject record=stored.getJSONObject("record");
        if(!UUID.fromString(id).toString().equals(record.getString("id"))) throw new IOException("Capture identity does not match.");
        String target=record.getString("target");
        if(!"item".equals(target)&&!"container_interior".equals(target)) throw new IOException("Invalid capture target.");
        JSONObject geometry=record.getJSONObject("geometry");
        if(!"ply_point_cloud".equals(geometry.getString("format"))||!"metres".equals(geometry.getString("units"))) throw new IOException("Unsupported source geometry.");
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        List<float[]> points=new ArrayList<>();int declared=-1;
        byte[] ply=readCapture(capture,id,"points.ply",8000000);
        try(BufferedReader reader=new BufferedReader(new InputStreamReader(new DigestInputStream(new ByteArrayInputStream(ply),digest),StandardCharsets.UTF_8))) {
            if(!"ply".equals(reader.readLine())||!"format ascii 1.0".equals(reader.readLine())) throw new IOException("Unsupported source point format.");
            String line; boolean ended=false; int lines=2; List<String> properties=new ArrayList<>();
            while((line=reader.readLine())!=null&&++lines<=20) {
                if(line.equals("end_header")){ended=true;break;}
                if(line.startsWith("comment ")) continue;
                if(line.startsWith("element vertex ")&&declared==-1) declared=Integer.parseInt(line.substring(15));
                else if(line.startsWith("property ")) properties.add(line);
                else throw new IOException("Unsupported point header.");
            }
            if(!ended||declared<4||declared>DepthCloud.MAX_POINTS||declared!=geometry.getInt("pointCount")
                ||!properties.equals(Arrays.asList("property float x","property float y","property float z","property float confidence"))) throw new IOException("Invalid point header.");
            while((line=reader.readLine())!=null) {
                if(points.size()>=declared||line.length()>160) throw new IOException("Invalid point data length.");
                String[] parts=line.trim().split("\\s+");
                if(parts.length!=4) throw new IOException("Invalid point data.");
                float[] point=new float[4];
                for(int i=0;i<4;i++){point[i]=Float.parseFloat(parts[i]);if(!Float.isFinite(point[i]))throw new IOException("Invalid point value.");}
                if(Math.abs(point[0])>1.5||Math.abs(point[1])>1.5||Math.abs(point[2])>1.5||point[3]<0.8f||point[3]>1)throw new IOException("Point is outside supported capture values.");
                points.add(point);
            }
        } finally { Arrays.fill(ply,(byte)0); }
        if(points.size()!=declared) throw new IOException("Incomplete source points.");
        JSONObject envelopeDetails=geometry.optJSONObject("envelope");
        ScanEnvelope envelope;
        String method;
        if(envelopeDetails==null){envelope=ScanEnvelope.captureAligned(points);method="capture_aligned_legacy";}
        else {
            if(!ScanEnvelope.METHOD.equals(envelopeDetails.getString("method"))||Math.abs(envelopeDetails.getDouble("paddingMm")-2.5)>0.000001) throw new IOException("Unsupported source envelope.");
            envelope=ScanEnvelope.fit(points,DepthCloud.VOXEL_METRES/2);method=ScanEnvelope.METHOD;
            if(!envelope.basis.equals(envelopeDetails.getString("basis"))) throw new IOException("Source orientation no longer matches its metadata.");
        }
        JSONObject storedDimensions=stored.getJSONObject("dimensionsMm");
        double[] expected={storedDimensions.getDouble("length"),storedDimensions.getDouble("width"),storedDimensions.getDouble("height")};Arrays.sort(expected);
        for(int i=0;i<3;i++) if(!Double.isFinite(expected[2-i])||Math.abs(expected[2-i]-envelope.dimensionsMm[i])>0.001) throw new IOException("Source envelope no longer matches its metadata.");
        StringBuilder hash=new StringBuilder();for(byte value:digest.digest()){hash.append(Character.forDigit((value&255)>>4,16));hash.append(Character.forDigit(value&15,16));}
        check(); return new SourceGeometry(stored,record,points,envelope,method,hash.toString());
    }
    private static final class SourceGeometry {
        final JSONObject stored,record;final List<float[]> points;final ScanEnvelope envelope;final String method,hash;
        SourceGeometry(JSONObject stored,JSONObject record,List<float[]> points,ScanEnvelope envelope,String method,String hash){this.stored=stored;this.record=record;this.points=points;this.envelope=envelope;this.method=method;this.hash=hash;}
    }
    public JSONObject preview(String id) throws Exception {
        SourceGeometry source=readSource(id);JSONObject record=source.record;List<float[]> points=source.points;ScanEnvelope envelope=source.envelope;String method=source.method,target=record.getString("target");
        JSONArray preview=new JSONArray();
        int samples=Math.min(points.size(),8000);
        for(int i=0;i<samples;i++) {
            float[] point=points.get((int)((long)i*(points.size()-1)/Math.max(1,samples-1)));
            double[] projected=envelope.projectMm(point);
            for(int axis=0;axis<3;axis++) preview.put(Math.max(0,Math.min(envelope.dimensionsMm[axis],projected[axis])));
            preview.put(point[3]);
        }
        return finish(new JSONObject().put("id",record.getString("id")).put("target",target).put("format","point_cloud_preview").put("units","millimetres")
            .put("sourceHash",source.hash).put("pointCount",points.size()).put("samplePointCount",samples).put("pointsMm",preview)
            .put("envelope",new JSONObject().put("method",method).put("basis",envelope.basis).put("paddingMm",envelope.paddingMm)
                .put("dimensionsMm",new JSONObject().put("length",envelope.dimensionsMm[0]).put("width",envelope.dimensionsMm[1]).put("height",envelope.dimensionsMm[2]))));
    }

    /** Reconstruct from EVERY verified saved point, never from the sampled preview. */
    public JSONObject reconstruct(String id) throws Exception {
        SourceGeometry source=readSource(id);
        if(!"item".equals(source.record.getString("target")))throw new IOException("Bag walls do not establish an occupied object or usable cavity. Interior reconstruction needs a separate model.");
        if(source.points.size()>=DepthCloud.MAX_POINTS)throw new IOException("The source reached the point limit; completeness cannot be established for reconstruction.");
        JSONObject quality=source.record.getJSONObject("quality");
        if(quality.getInt("depthFrames")<6||quality.getInt("viewCount")<3||source.points.size()<300)throw new IOException("More source coverage is required for reconstruction.");
        List<double[]> points=new ArrayList<>(source.points.size());for(float[] point:source.points)points.add(source.envelope.projectMm(point));
        VoxelSolid solid=VoxelSolid.reconstruct(points,source.envelope.dimensionsMm);
        JSONArray occupied=new JSONArray();for(int cell:solid.occupiedCells)occupied.put(cell);
        return finish(new JSONObject().put("id",source.record.getString("id")).put("target","item").put("format","voxel_solid_v1").put("units","millimetres")
            .put("sourceHash",source.hash).put("sourcePointCount",source.points.size()).put("method",VoxelSolid.METHOD)
            .put("resolutionMm",solid.resolutionMm).put("grid",new JSONObject().put("x",solid.nx).put("y",solid.ny).put("z",solid.nz))
            .put("occupiedCells",occupied).put("observedCellCount",solid.observedCellCount).put("enclosedCellCount",solid.enclosedCellCount).put("surfaceFaceCount",solid.faceCount)
            .put("dimensionsMm",new JSONObject().put("length",solid.nx*solid.resolutionMm).put("width",solid.ny*solid.resolutionMm).put("height",solid.nz*solid.resolutionMm))
            .put("warnings",new JSONArray().put("This is a block surface reconstructed from observed cells and enclosed regions, not proof of complete physical geometry.")
                .put("Exterior-connected concavities stay open. Hidden cavities are filled; narrow openings can disappear at this resolution. No holes were deliberately patched.")
                .put("Cell rounding is a sampling allowance, not a sensor-error bound. Only an explicitly adopted, uniformly scaled shape is used for occupied-cell packing; physical fit remains unverified.")));
    }

    /** Empty cavity cells are separate from occupied item cells; nothing is adopted or written here. */
    public JSONObject reconstructInterior(String id,int openingAxis,int openingSign,double[] seedMm) throws Exception {
        SourceGeometry source=readSource(id);
        if(!"container_interior".equals(source.record.getString("target")))throw new IOException("Interior reconstruction requires an empty bag-interior source.");
        JSONObject quality=source.record.getJSONObject("quality");
        if(source.points.size()<300||source.points.size()>=DepthCloud.MAX_POINTS||quality.getInt("depthFrames")<6||quality.getInt("viewCount")<3)
            throw new IOException("More uncapped source coverage is required for interior reconstruction.");
        List<double[]> points=new ArrayList<>(source.points.size());for(float[] point:source.points)points.add(source.envelope.projectMm(point));
        VoxelCavity cavity=VoxelCavity.reconstruct(points,source.envelope.dimensionsMm,openingAxis,openingSign,seedMm);
        JSONArray free=new JSONArray(),opening=new JSONArray(),observed=new JSONArray();for(int cell:cavity.freeCells)free.put(cell);for(int cell:cavity.openingCells)opening.put(cell);for(int cell:cavity.observedCells)observed.put(cell);
        return finish(new JSONObject().put("id",source.record.getString("id")).put("target","container_interior").put("format","voxel_cavity_v1").put("units","millimetres")
            .put("sourceHash",source.hash).put("sourcePointCount",source.points.size()).put("method",VoxelCavity.METHOD)
            .put("grid",new JSONObject().put("x",cavity.nx).put("y",cavity.ny).put("z",cavity.nz))
            .put("boundsMm",dimensions(cavity.boundsMm)).put("cellSizeMm",dimensions(cavity.cellSizeMm))
            .put("seedMm",new JSONObject().put("x",seedMm[0]).put("y",seedMm[1]).put("z",seedMm[2]))
            .put("opening",new JSONObject().put("axis",openingAxis).put("sign",openingSign).put("planeMm",openingSign==1?cavity.boundsMm[openingAxis]:0).put("cells",opening))
            .put("freeCells",free).put("observedCells",observed).put("wallCellCount",cavity.wallCellCount).put("surfaceFaceCount",cavity.surfaceFaceCount).put("estimatedVolumeMm3",cavity.estimatedVolumeMm3)
            .put("warnings",new JSONArray().put("This is one estimated empty component selected by an interior seed. Other compartments and hidden cavities are not included.")
                .put("The selected opening plane is a reviewed assumption, not an observed wall or a measured narrowest entry. Source axes do not infer travel orientation.")
                .put("Observed cells stay unavailable. Only the selected opening is capped for boundary checking; missing walls or floor reaching other envelope faces are rejected.")
                .put("Finite cells can hide narrow gaps, thicken walls or miss unobserved intrusions. Sampling spacing does not bound physical error, usable capacity or closure. Nothing was adopted into the packing plan.")));
    }

    private static JSONObject dimensions(double[] values) throws Exception {
        return new JSONObject().put("length",values[0]).put("width",values[1]).put("height",values[2]);
    }

    private File privateFile(File capture,String name,long maxBytes) throws IOException {
        check();
        File file=new File(capture,name).getCanonicalFile();
        if(!capture.equals(file.getParentFile())||!file.isFile()||file.length()<1||file.length()>maxBytes)throw new IOException("Private capture file unavailable or invalid.");
        return file;
    }

    public boolean delete(String id) throws IOException {
        return checked(() -> {
            File capture = folder(id);
            if (!capture.exists()) return false;
            removeTree(capture);
            return true;
        });
    }

    public int clear() throws IOException {
        return checked(() -> {
        File[] captures = root.listFiles();
        if (captures == null) throw new IOException("Capture storage could not be read.");
        int removed = 0;
        for (File capture : captures) {
            if (capture.isDirectory() && capture.getName().matches(CAPTURE_ID_PATTERN)) { delete(capture.getName()); removed++; }
        }
        return removed;
        });
    }

    /** Delete original point bytes only, retaining the authenticated source provenance.
     * No clock, paths, IDs to delete, or workspace key are accepted from the WebView.
     * Every file mutation is rechecked against this store's original revocable lease. */
    public JSONObject pruneExpiredSources(int days,String afterId) throws Exception {
        if(access==null || days!=7&&days!=30&&days!=90)throw new IOException("Choose a supported source retention period and a live workspace.");
        if(afterId!=null&&!afterId.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))throw new IOException("Invalid retention cursor.");
        check();
        final long now=clock.milliseconds(),cutoff=now-days*86400000L;
        if(now<0||cutoff<0)throw new IOException("The device clock cannot establish scan age.");
        File[] all=checked(()->root.listFiles());
        if(all==null)throw new IOException("Capture storage could not be read.");
        java.util.List<String> ids=new java.util.ArrayList<>();
        for(File file:all)if(file.isDirectory()&&file.getName().matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")&&(afterId==null||file.getName().compareTo(afterId)>0))ids.add(file.getName());
        java.util.Collections.sort(ids);
        JSONArray removed=new JSONArray();int skipped=0,failed=0,deleted=0,count=Math.min(ids.size(),RETENTION_BATCH_SIZE);
        SimpleDateFormat format=new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));format.setLenient(false);
        for(int i=0;i<count;i++){
            check();String id=ids.get(i);File capture=folder(id);byte[] metadata=null;long created;
            try{
                metadata=readCapture(capture,id,"capture.json",20000);
                JSONObject record=new JSONObject(new String(metadata,StandardCharsets.UTF_8)).getJSONObject("record");
                String date=record.getString("createdAt");java.text.ParsePosition position=new java.text.ParsePosition(0);Date parsed=format.parse(date,position);
                if(!id.equals(record.getString("id"))||!"android".equals(record.getString("platform"))||!"arcore_depth".equals(record.getString("method"))
                    ||!java.util.Arrays.asList("item","container_interior").contains(record.getString("target"))||!record.getBoolean("modelStoredLocally")
                    ||!"ply_point_cloud".equals(record.getJSONObject("geometry").getString("format"))||parsed==null||position.getIndex()!=date.length())throw new IOException("Invalid completed source provenance.");
                created=parsed.getTime();if(created<0||created>now)throw new IOException("Scan age is not established.");
            }catch(Exception invalid){check();skipped++;continue;}
            finally{if(metadata!=null)Arrays.fill(metadata,(byte)0);}
            if(created>cutoff)continue;
            try{
                boolean changed=checked(()->{
                    boolean hadSource=false;String name=encrypted()?"points.ply.sealed":"points.ply";
                    for(String candidate:new String[]{name,name+".partial"}){
                        File source=new File(capture,candidate),canonical=source.getCanonicalFile();
                        if(!capture.equals(canonical.getParentFile())||!candidate.equals(canonical.getName()))throw new IOException("Invalid private source location.");
                        hadSource|=source.exists();
                        if(source.exists()&&(!source.isFile()||!source.delete()))throw new IOException("The expired source could not be removed.");
                        if(source.exists())throw new IOException("Source removal could not be confirmed.");
                    }
                    return hadSource;
                });
                if(changed)deleted++;removed.put(id);
            }catch(IOException error){check();failed++;}
        }
        return finish(new JSONObject().put("version",1).put("confirmedAt",format.format(new Date(now))).put("removedIds",removed)
            .put("checkedCount",count).put("deletedCount",deleted).put("skippedCount",skipped).put("failedCount",failed)
            .put("nextCursor",ids.size()>count?ids.get(count-1):JSONObject.NULL));
    }

    private boolean encrypted() { return access != null && access.protectedWorkspace(); }

    private void writeCapture(File capture,String id,String name,byte[] plain) throws IOException {
        byte[] output = null;
        try {
            output = encrypted() ? access.seal(id,name,plain) : plain;
            final byte[] bytes = output;
            checked(() -> {
                String diskName = name + (encrypted() ? ".sealed" : "");
                File destination = new File(capture,diskName).getCanonicalFile();
                File partial = new File(capture,diskName + ".partial").getCanonicalFile();
                if (!capture.equals(destination.getParentFile()) || !capture.equals(partial.getParentFile()) || destination.exists() || partial.exists())
                    throw new IOException("Invalid capture write location.");
                try (FileOutputStream out = new FileOutputStream(partial)) { out.write(bytes); out.getFD().sync(); }
                if (!partial.renameTo(destination)) throw new IOException("The capture file could not be finalized.");
                return null;
            });
        } finally {
            Arrays.fill(plain,(byte)0);
            if (output != null && output != plain) Arrays.fill(output,(byte)0);
        }
    }

    private byte[] readCapture(File capture,String id,String name,int limit) throws IOException {
        byte[] disk = null;
        try {
            disk = checked(() -> {
                int maximum = limit + (encrypted() ? CaptureScopeManager.SEALED_OVERHEAD : 0);
                File file = privateFile(capture,name + (encrypted() ? ".sealed" : ""),maximum);
                try (FileInputStream in = new FileInputStream(file); PlainBuffer buffer = new PlainBuffer(maximum)) {
                    byte[] chunk = new byte[8192];
                    try {
                        int count; while ((count=in.read(chunk)) != -1) buffer.write(chunk,0,count);
                        return buffer.toByteArray();
                    } finally { Arrays.fill(chunk,(byte)0); }
                } catch (IllegalStateException error) { throw new IOException("Capture file exceeds its size limit."); }
            });
            byte[] plain = encrypted() ? access.unseal(id,name,disk) : disk;
            if (plain.length < 1 || plain.length > limit) { Arrays.fill(plain,(byte)0); throw new IOException("Invalid capture data length."); }
            return plain;
        } finally { if (encrypted() && disk != null) Arrays.fill(disk,(byte)0); }
    }

    /** Bounds temporary memory and erases the owned byte buffer after serialization/read. */
    private static final class PlainBuffer extends ByteArrayOutputStream {
        private final int limit;
        PlainBuffer(int limit) { this.limit=limit; }
        @Override public synchronized void write(byte[] bytes,int offset,int length) {
            if (offset < 0 || length < 0 || offset > bytes.length-length) throw new IndexOutOfBoundsException();
            if (length > limit-count) throw new IllegalStateException("Capture data exceeds its size limit.");
            reserve(count+length);
            super.write(bytes,offset,length);
        }
        @Override public synchronized void write(int value) {
            if (count >= limit) throw new IllegalStateException("Capture data exceeds its size limit.");
            reserve(count+1);
            super.write(value);
        }
        private void reserve(int capacity) {
            if (capacity <= buf.length) return;
            byte[] previous=buf;
            buf=Arrays.copyOf(previous,Math.min(limit,Math.max(capacity,previous.length*2)));
            Arrays.fill(previous,(byte)0);
        }
        @Override public synchronized void close() { Arrays.fill(buf,(byte)0); reset(); }
    }

    private void removeTree(File file) throws IOException {
        File canonical = file.getCanonicalFile();
        // File.toPath/java.nio.file require API 26; capture also supports Android API 24.
        if (!canonical.getPath().startsWith(root.getPath() + File.separator)) throw new IOException("Refusing an invalid capture path.");
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children == null) throw new IOException("Capture files could not be read.");
            for (File child : children) removeTree(child);
        }
        if (!file.delete()) throw new IOException("A capture file could not be removed.");
    }
}
