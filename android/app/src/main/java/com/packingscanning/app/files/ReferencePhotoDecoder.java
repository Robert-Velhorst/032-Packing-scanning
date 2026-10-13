package com.packingscanning.app.files;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import java.io.*;

/** Sample before pixel allocation; render to JPEG to exclude source EXIF/GPS and active formats. */
public final class ReferencePhotoDecoder {
    private ReferencePhotoDecoder(){}
    public static byte[] jpeg(byte[] input)throws IOException{
        PendingItemPhotoStore.imageMime(input);
        BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(input,0,input.length,options);
        if(options.outWidth<=0||options.outHeight<=0||(long)options.outWidth*options.outHeight>100_000_000L)throw new IOException("Choose a supported photo under 100 megapixels.");
        options.inSampleSize=1;while(Math.max(options.outWidth,options.outHeight)/options.inSampleSize>2048)options.inSampleSize*=2;
        options.inJustDecodeBounds=false;Bitmap bitmap=BitmapFactory.decodeByteArray(input,0,input.length,options);if(bitmap==null)throw new IOException("The selected photo could not be decoded.");
        Bitmap oriented=bitmap;
        try{
            Matrix transform=new Matrix();int orientation=ExifInterface.ORIENTATION_NORMAL;
            try{orientation=new ExifInterface(new ByteArrayInputStream(input)).getAttributeInt(ExifInterface.TAG_ORIENTATION,ExifInterface.ORIENTATION_NORMAL);}catch(IOException ignored){/* Some supported formats have no EXIF. */}
            switch(orientation){
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:transform.setScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_180:transform.setRotate(180);break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL:transform.setScale(1,-1);break;
                case ExifInterface.ORIENTATION_TRANSPOSE:transform.setRotate(90);transform.postScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_90:transform.setRotate(90);break;
                case ExifInterface.ORIENTATION_TRANSVERSE:transform.setRotate(-90);transform.postScale(-1,1);break;
                case ExifInterface.ORIENTATION_ROTATE_270:transform.setRotate(-90);break;
                default:break;
            }
            if(!transform.isIdentity())oriented=Bitmap.createBitmap(bitmap,0,0,bitmap.getWidth(),bitmap.getHeight(),transform,true);
            ByteArrayOutputStream output=new ByteArrayOutputStream();if(!oriented.compress(Bitmap.CompressFormat.JPEG,85,output))throw new IOException("The reference photo could not be prepared.");
            byte[] bytes=output.toByteArray();if(bytes.length>PendingItemPhotoStore.MAX_PHOTO_BYTES)throw new IOException("The reference photo is too large.");return bytes;
        }finally{if(oriented!=bitmap)oriented.recycle();bitmap.recycle();}
    }
}
