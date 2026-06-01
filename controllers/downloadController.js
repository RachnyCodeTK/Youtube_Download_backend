const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");
const { promisify } = require("util");

const execPromise = promisify(exec);

const getFfmpegLocation = async () => {
  const isWindows = process.platform === "win32";
  const checkCommand = isWindows ? "where ffmpeg" : "which ffmpeg";

  try {
    const { stdout } = await execPromise(checkCommand);
    const foundPath = stdout.split(/\r?\n/).find((line) => line.trim());
    if (foundPath) {
      return foundPath.trim();
    }
  } catch {
    // ignore
  }

  const checkPaths = [];
  if (process.env.PATH) {
    process.env.PATH.split(path.delimiter).forEach((p) => {
      if (p) {
        checkPaths.push(path.join(p, "ffmpeg"));
        if (isWindows) {
          checkPaths.push(path.join(p, "ffmpeg.exe"));
        }
      }
    });
  }

  if (isWindows) {
    checkPaths.push(path.join(process.env.ProgramFiles || "C:\\Program Files", "ffmpeg", "bin", "ffmpeg.exe"));
    checkPaths.push(path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "ffmpeg", "bin", "ffmpeg.exe"));
    checkPaths.push(path.join(process.env.USERPROFILE || "C:\\Users\\Default", "scoop", "apps", "ffmpeg", "current", "bin", "ffmpeg.exe"));
    checkPaths.push(path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe", "ffmpeg-8.1.1-full_build", "bin", "ffmpeg.exe"));
    checkPaths.push(path.join(process.env.LOCALAPPDATA || "", "CapCut", "Apps", "4.3.0.1694", "ffmpeg.exe"));
    checkPaths.push(path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages"));
    checkPaths.push(path.join(process.env.LOCALAPPDATA || "", "CapCut", "Apps"));
    checkPaths.push(path.join(process.env.USERPROFILE || "", "AppData", "Local"));
  } else {
    checkPaths.push("/usr/bin/ffmpeg");
    checkPaths.push("/usr/local/bin/ffmpeg");
  }

  const tryFile = (filePath) => {
    return filePath && fs.existsSync(filePath);
  };

  const findFfmpegRecursively = (baseDir, depth = 3) => {
    if (!baseDir || depth < 0 || !fs.existsSync(baseDir)) {
      return null;
    }

    try {
      const entries = fs.readdirSync(baseDir, { withFileTypes: true });
      for (const entry of entries) {
        const entryPath = path.join(baseDir, entry.name);
        if (entry.isFile() && entry.name.toLowerCase() === "ffmpeg.exe") {
          return entryPath;
        }
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const found = findFfmpegRecursively(path.join(baseDir, entry.name), depth - 1);
          if (found) {
            return found;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  };

  for (const ffmpegPath of checkPaths) {
    if (ffmpegPath && tryFile(ffmpegPath)) {
      return ffmpegPath;
    }
  }

  if (isWindows) {
    const recursiveCandidates = [
      path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WinGet", "Packages"),
      path.join(process.env.LOCALAPPDATA || "", "CapCut", "Apps"),
      path.join(process.env.USERPROFILE || "", "AppData", "Local"),
    ];
    for (const candidate of recursiveCandidates) {
      const found = findFfmpegRecursively(candidate, 4);
      if (found) {
        return found;
      }
    }
  }

  return null;
};

const detectPlatform = (url) => {
  if (url.includes("youtube.com") || url.includes("youtu.be")) {
    return "youtube";
  } else if (url.includes("facebook.com") || url.includes("fb.com") || url.includes("fb.watch")) {
    return "facebook";
  } else if (url.includes("tiktok.com")) {
    return "tiktok";
  } else if (url.includes("instagram.com")) {
    return "instagram";
  }
  return "unknown";
};

const validateURL = (url, platform) => {
  if (platform === "tiktok") {
    if (url.includes("/photo/")) {
      return { valid: false, error: "TikTok photos are not supported. Please use a TikTok video URL instead." };
    }
    if (!url.includes("/video/")) {
      return { valid: false, error: "Invalid TikTok URL. Please use a direct TikTok video link." };
    }
  }
  return { valid: true };
};

const sanitizeFilename = (filename) => {
  // First remove/replace special characters
  let sanitized = filename
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^\w\s._-]/g, "_") // Replace non-ASCII special chars
    .slice(0, 100);
  
  // Remove consecutive underscores
  sanitized = sanitized.replace(/_+/g, "_");
  
  return sanitized;
};

const encodeFilenameHeader = (filename) => {
  // RFC 5987 encoding for non-ASCII filenames in Content-Disposition header
  try {
    // Try ASCII first - if it works, use as is
    if (/^[\x20-\x7E]*$/.test(filename)) {
      return `attachment; filename="${filename}"`;
    }
    // For non-ASCII, use RFC 5987 encoding
    const encoded = Buffer.from(filename).toString('utf8');
    return `attachment; filename*=UTF-8''${encodeURIComponent(encoded)}`;
  } catch (e) {
    return `attachment; filename="download"`;
  }
};

const getVideoTitle = async (url) => {
  try {
    const { stdout } = await execPromise(
      `yt-dlp --no-warnings --print filename -o "%(title)s" "${url}"`,
      { timeout: 30000 }
    );
    const title = stdout.trim().split(/\r?\n/)[0];
    return title ? sanitizeFilename(title) : null;
  } catch (error) {
    console.warn("Could not fetch video title:", error.message);
    return null;
  }
};

exports.downloadVideo = async (req, res) => {
  try {
    const { url, type, platform } = req.body; // type can be 'mp4' or 'mp3'

    if (!url) {
      return res.status(400).json({
        message: "URL is required",
      });
    }

    const detectedPlatform = platform || detectPlatform(url);
    if (detectedPlatform === "unknown") {
      return res.status(400).json({
        message: "Unsupported URL. Please provide a valid YouTube, Facebook, TikTok, or Instagram URL",
      });
    }

    // Validate URL for platform-specific requirements
    const urlValidation = validateURL(url, detectedPlatform);
    if (!urlValidation.valid) {
      return res.status(400).json({
        message: urlValidation.error,
      });
    }

    console.log(`[${detectedPlatform}] Fetching video information...`);
    let videoTitle = await getVideoTitle(url);
    if (!videoTitle) {
      videoTitle = `download_${Date.now()}`;
      console.log("Using fallback filename:", videoTitle);
    } else {
      console.log("Video title:", videoTitle);
    }

    const fileName = videoTitle;
    const downloadDir = path.join(__dirname, "../downloads");
    const outputPath = path.join(downloadDir, `${fileName}.%(ext)s`);
    const ytDlpFlags = "--no-playlist --no-warnings --concurrent-fragments 16 --fragment-retries 5 --retries 3 --socket-timeout 15";

    try {
      if (type === "mp3") {
        const ffmpegLocation = await getFfmpegLocation();
        if (!ffmpegLocation) {
          return res.status(500).json({
            message:
              "MP3 conversion requires ffmpeg. Install ffmpeg and add it to your PATH. Example: Windows: choco install ffmpeg or add C:\\Program Files\\ffmpeg\\bin to PATH.",
          });
        }

        const ffmpegDir = fs.existsSync(ffmpegLocation) && path.extname(ffmpegLocation).toLowerCase() === ".exe"
          ? path.dirname(ffmpegLocation)
          : ffmpegLocation;

        console.log("Detected ffmpeg location:", ffmpegLocation);
        console.log("Using ffmpeg directory:", ffmpegDir);
        console.log(`Downloading ${detectedPlatform} content as MP3`);

        try {
          await execPromise(
            `yt-dlp ${ytDlpFlags} -x --audio-format mp3 --audio-quality 192 --ffmpeg-location "${ffmpegDir}" -o "${outputPath}" "${url}"`,
            { timeout: 300000 }
          );
        } catch (mp3Error) {
          const stderr = mp3Error.stderr || "";
          const stdout = mp3Error.stdout || "";
          console.error("MP3 conversion failed stderr:", stderr);
          console.error("MP3 conversion failed stdout:", stdout);
          const errorMsg = stderr || mp3Error.message || "Unknown MP3 conversion error";
          if (errorMsg.toLowerCase().includes("ffmpeg")) {
            return res.status(500).json({
              message:
                "ffmpeg is installed but failed during MP3 conversion. Please verify your ffmpeg installation and try again. Error: " + errorMsg,
            });
          }
          throw mp3Error;
        }
      } else if (type === "mp4") {
        console.log(`Downloading ${detectedPlatform} content as MP4`);
        await execPromise(
          `yt-dlp ${ytDlpFlags} -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best" --merge-output-format mp4 -o "${outputPath}" "${url}"`,
          { timeout: 300000 }
        );
      } else {
        return res.status(400).json({
          message: "Invalid format type. Use 'mp3' or 'mp4'",
        });
      }
    } catch (downloadError) {
      console.error("yt-dlp error:", downloadError.message);
      const errorMsg = downloadError.message || "Unknown error";
      
      if (errorMsg.includes("ffmpeg")) {
        return res.status(500).json({
          message: "ffmpeg is required but not installed. Install it with: pip install ffmpeg-python or use your system package manager",
        });
      }
      
      return res.status(500).json({
        message: "Download failed: " + errorMsg,
      });
    }

    const files = fs.readdirSync(downloadDir);
    const targetFile = files.find((file) => file.startsWith(fileName));

    if (!targetFile) {
      return res.status(404).json({
        message: "File not found after download",
      });
    }

    const filePath = path.join(downloadDir, targetFile);

    // Check if file exists and has content
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        message: "File path does not exist",
      });
    }

    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      return res.status(400).json({
        message: "Downloaded file is empty",
      });
    }

    const deleteTempFile = () => {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log("File deleted:", targetFile);
        } catch (deleteError) {
          console.error("File deletion error:", deleteError);
        }
      }
    };

    let cleanupCalled = false;
    const cleanup = () => {
      if (cleanupCalled) {
        return;
      }
      cleanupCalled = true;
      deleteTempFile();
    };

    const platformLabel = detectedPlatform.charAt(0).toUpperCase() + detectedPlatform.slice(1);
    const finalFileName = type === "mp3" ? `${videoTitle}.mp3` : `${videoTitle}.mp4`;
    
    // Use proper header encoding for non-ASCII characters
    const contentDisposition = encodeFilenameHeader(finalFileName);
    res.setHeader("Content-Disposition", contentDisposition);
    res.setHeader("Content-Type", type === "mp3" ? "audio/mpeg" : "video/mp4");
    res.setHeader("Content-Length", stats.size);

    const fileStream = fs.createReadStream(filePath);

    res.on("close", () => {
      if (!res.writableEnded) {
        console.warn("Client disconnected before download finished.");
      }
      cleanup();
    });

    res.on("finish", () => {
      cleanup();
    });

    fileStream.on("error", (streamErr) => {
      console.error("File stream error:", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ message: "File stream error" });
      } else {
        res.end();
      }
      cleanup();
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({
      message: "Download failed: " + (error.message || "Unknown error"),
    });
  }
};