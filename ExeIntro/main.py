import tkinter as tk
import customtkinter as ctk
import cv2
import time
import os
import pygame
from PIL import Image

# root oluştur
root = ctk.CTk()
root.withdraw()

BG = "#000000"

def resource_path(path):
    return path  # basit kullanım (exe değilse)

# --- Splash Screen ---
splash = ctk.CTkToplevel(root)
splash.overrideredirect(True)
splash.attributes("-topmost", True)
splash.configure(fg_color=BG)

try:
    pygame.mixer.init()
except:
    pass

try:
    vid_path = resource_path("exe.mp4")
    cap = cv2.VideoCapture(vid_path)

    if not cap.isOpened():
        raise Exception("Video açılamadı")

    orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30
    delay = int(1000 / fps)

    splash_w = 400
    splash_h = int(orig_h * splash_w / orig_w)

    lbl = ctk.CTkLabel(splash, text="")
    lbl.pack(expand=True, fill="both")

    splash.update_idletasks()
    sw = splash.winfo_screenwidth()
    sh = splash.winfo_screenheight()
    splash.geometry(f"{splash_w}x{splash_h}+{(sw-splash_w)//2}+{(sh-splash_h)//2}")

    start_time = time.time()

    # ses
    try:
        mp3_path = resource_path("exe.mp3")
        wav_path = resource_path("exe.wav")

        if os.path.exists(mp3_path):
            pygame.mixer.music.load(mp3_path)
            pygame.mixer.music.play()
        elif os.path.exists(wav_path):
            pygame.mixer.music.load(wav_path)
            pygame.mixer.music.play()
    except:
        pass

    def end_splash():
        if splash.winfo_exists():
            splash.destroy()
        if cap.isOpened():
            cap.release()
        try:
            pygame.mixer.music.stop()
        except:
            pass
        root.destroy()

    def update_frame():
        if time.time() - start_time > 3.5:
            end_splash()
            return

        ret, frame = cap.read()
        if not ret:
            end_splash()
            return

        frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        img_pil = Image.fromarray(frame_rgb)

        img_ctk = ctk.CTkImage(
            light_image=img_pil,
            dark_image=img_pil,
            size=(splash_w, splash_h)
        )

        lbl.configure(image=img_ctk)
        splash.after(delay, update_frame)

    update_frame()

    root.mainloop()

except Exception as e:
    print("Hata:", e)
    try:
        splash.destroy()
    except:
        pass
    root.destroy()