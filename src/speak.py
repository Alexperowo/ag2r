import sys
import os
import asyncio
import subprocess

# Determine scratch directory for audio temp files
scratch_dir = os.path.join(os.path.expanduser("~"), ".gemini", "antigravity", "scratch")
mp3_path = os.path.join(scratch_dir, "speech_temp.mp3")
wav_path = os.path.join(scratch_dir, "speech_temp.wav")

async def generate_edge_tts(text, output_file):
    """Generates neural speech using Microsoft Edge TTS (ru-RU-SvetlanaNeural)."""
    import edge_tts
    communicate = edge_tts.Communicate(text, "ru-RU-SvetlanaNeural")
    await communicate.save(output_file)

def generate_sapi_tts(text, output_file):
    """Fallback: Offline WAV generation via Windows SAPI using PowerShell."""
    abs_path = os.path.abspath(output_file).replace("/", "\\")
    escaped_text = text.replace("'", "''")
    ps_cmd = f"Add-Type -AssemblyName System.Speech; $speak = New-Object System.Speech.Synthesis.SpeechSynthesizer; $speak.SelectVoice('Microsoft Irina Desktop'); $speak.SetOutputToWaveFile('{abs_path}'); $speak.Speak('{escaped_text}'); $speak.Dispose();"
    try:
        subprocess.run(["powershell", "-Command", ps_cmd], check=True, capture_output=True)
        return True
    except Exception as e:
        print(f"PowerShell SAPI Error: {e}", file=sys.stderr)
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python speak.py \"text to speak\"")
        sys.exit(1)
        
    text = sys.argv[1]
    
    os.makedirs(scratch_dir, exist_ok=True)
    
    for p in [mp3_path, wav_path]:
        if os.path.exists(p):
            try:
                os.remove(p)
            except Exception:
                pass
                
    success = False
    
    # Step 1: Try premium Edge TTS (Svetlana)
    try:
        asyncio.run(generate_edge_tts(text, mp3_path))
        if os.path.exists(mp3_path) and os.path.getsize(mp3_path) > 1000:
            print(mp3_path)
            success = True
    except Exception as e:
        pass
        
    # Step 2: Fallback to Windows SAPI (Irina)
    if not success:
        if generate_sapi_tts(text, wav_path):
            if os.path.exists(wav_path) and os.path.getsize(wav_path) > 1000:
                print(wav_path)
                success = True

if __name__ == "__main__":
    main()
