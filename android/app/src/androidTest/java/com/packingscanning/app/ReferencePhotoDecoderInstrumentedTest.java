package com.packingscanning.app;
import android.graphics.*;
import android.media.ExifInterface;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.packingscanning.app.files.ReferencePhotoDecoder;
import org.junit.*;
import org.junit.runner.RunWith;
import java.io.*;
import static org.junit.Assert.*;
/** Compiled acceptance cases; execution needs an Android device and is reported separately. */
@RunWith(AndroidJUnit4.class)
public class ReferencePhotoDecoderInstrumentedTest {
    @Test public void convertsPngToBoundedJpeg()throws Exception{
        Bitmap source=Bitmap.createBitmap(4096,1024,Bitmap.Config.ARGB_8888);source.eraseColor(Color.RED);ByteArrayOutputStream input=new ByteArrayOutputStream();source.compress(Bitmap.CompressFormat.PNG,100,input);source.recycle();
        byte[] output=ReferencePhotoDecoder.jpeg(input.toByteArray());assertEquals((byte)0xff,output[0]);assertEquals((byte)0xd8,output[1]);Bitmap decoded=BitmapFactory.decodeByteArray(output,0,output.length);assertNotNull(decoded);assertTrue(Math.max(decoded.getWidth(),decoded.getHeight())<=2048);decoded.recycle();
    }
    @Test public void appliesExifOrientationAndExcludesGpsAndCameraMetadata()throws Exception{
        File file=File.createTempFile("synthetic-exif-",".jpg",InstrumentationRegistry.getInstrumentation().getTargetContext().getCacheDir());
        try{
            Bitmap source=Bitmap.createBitmap(32,16,Bitmap.Config.ARGB_8888);source.eraseColor(Color.BLUE);try(OutputStream out=new FileOutputStream(file)){source.compress(Bitmap.CompressFormat.JPEG,95,out);}source.recycle();
            ExifInterface metadata=new ExifInterface(file.getAbsolutePath());metadata.setAttribute(ExifInterface.TAG_ORIENTATION,String.valueOf(ExifInterface.ORIENTATION_ROTATE_90));metadata.setAttribute(ExifInterface.TAG_MAKE,"synthetic-private-camera");metadata.setAttribute(ExifInterface.TAG_GPS_LATITUDE,"51/1,0/1,0/1");metadata.setAttribute(ExifInterface.TAG_GPS_LATITUDE_REF,"N");metadata.saveAttributes();
            byte[] bytes=new byte[(int)file.length()];try(DataInputStream in=new DataInputStream(new FileInputStream(file))){in.readFully(bytes);}byte[] output=ReferencePhotoDecoder.jpeg(bytes);ExifInterface sanitized=new ExifInterface(new ByteArrayInputStream(output));assertNull(sanitized.getAttribute(ExifInterface.TAG_GPS_LATITUDE));assertNull(sanitized.getAttribute(ExifInterface.TAG_MAKE));Bitmap decoded=BitmapFactory.decodeByteArray(output,0,output.length);assertEquals(16,decoded.getWidth());assertEquals(32,decoded.getHeight());decoded.recycle();
        }finally{assertTrue(file.delete());}
    }
}
