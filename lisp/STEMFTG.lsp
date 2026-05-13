;;; ====================================================================
;;; STEMFTG.LSP - Typical Stem Wall and Footing Section Detail
;;; --------------------------------------------------------------------
;;; Command:  STEMFTG
;;; Units:    Decimal inches (all input/output in inches)
;;; Origin:   User picks insertion point = bottom CENTER of footing
;;;
;;; Draws a residential-typical reinforced concrete stem wall on a
;;; continuous spread footing, in section view, including:
;;;   - Concrete outline (single closed polyline)
;;;   - ANSI31 concrete hatch
;;;   - Rebar: (2) horizontal bars at footing bottom (cross-section
;;;            dots), (2) horizontal bars at top of stem, (2) horizontal
;;;            bars at mid stem, vertical dowels with 90-deg. std hooks
;;;            tying stem to footing
;;;   - Finish grade lines + EARTH hatch on both sides
;;;   - Linear dimensions (footing W x D, stem W x H, total height)
;;;   - Keynote text with leaders
;;;
;;; All rebar is shown with the specified clear cover (default 3" per
;;; ACI 318 for concrete cast against earth -- exposed faces).
;;; ====================================================================

(defun *error* (msg)
  (and *stf-oldecho* (setvar "CMDECHO"  *stf-oldecho*))
  (and *stf-oldos*   (setvar "OSMODE"   *stf-oldos*))
  (and *stf-oldlyr*  (setvar "CLAYER"   *stf-oldlyr*))
  (and *stf-olddsc*  (setvar "DIMSCALE" *stf-olddsc*))
  (and *stf-olderr*  (setq  *error*    *stf-olderr*))
  (if (and msg (/= msg "Function cancelled") (/= msg "quit / exit abort"))
    (princ (strcat "\nSTEMFTG error: " msg)))
  (princ))

;;; --- Helpers --------------------------------------------------------

(defun stf:mklay (name clr)
  (if (not (tblsearch "LAYER" name))
    (command "_.-LAYER" "_N" name "_C" (itoa clr) name "")))

(defun stf:dot (ctr dia)
  (command "_.DONUT" 0 dia ctr ""))

(defun stf:note (apt tailpt txt h / knee)
  ;; L-shaped leader: arrow point -> knee (above/below apt) -> tail,
  ;; then place text starting just past tail end.
  (setq knee (list (car apt) (cadr tailpt)))
  (command "_.PLINE" apt knee tailpt "")
  (command "_.TEXT"
    (list (+ (car tailpt) (* h 0.4)) (- (cadr tailpt) (/ h 2.0)))
    h 0 txt))

;;; --- Main command ---------------------------------------------------

(defun c:STEMFTG ( /
        ip sw sh fw fd cov bar bd barlbl gradeExp txtH
        xL xR fxL fxR yFBot yFTop yT gradeY hookLen earthExt
        concEnt earthL earthR noteX
        ftgL ftgR stmTL stmTR stmML stmMR
        dwlLx dwlRx dwlBy dwlTy dimOff )

  (setq *stf-olderr*  *error*
        *stf-oldecho* (getvar "CMDECHO")
        *stf-oldos*   (getvar "OSMODE")
        *stf-oldlyr*  (getvar "CLAYER")
        *stf-olddsc*  (getvar "DIMSCALE"))
  (setvar "CMDECHO" 0)
  (setvar "OSMODE" 0)

  ;; Layer setup (ACI color numbers)
  (stf:mklay "S-CONC"   7)   ; concrete outline
  (stf:mklay "S-HATCH"  8)   ; concrete hatch
  (stf:mklay "S-REBAR"  1)   ; rebar
  (stf:mklay "S-EARTH" 32)   ; earth hatch
  (stf:mklay "S-GRADE"  3)   ; finish grade line
  (stf:mklay "S-DIM"    4)   ; dimensions
  (stf:mklay "S-TEXT"   2)   ; notes & keynotes

  ;; --- Prompts -----------------------------------------------------
  (initget 1)
  (setq ip (getpoint "\nInsertion point (bottom CENTER of footing): "))

  (initget 7)
  (setq sw (getreal "\nStem wall WIDTH [in]: "))
  (initget 7)
  (setq sh (getreal "\nStem wall HEIGHT above footing [in]: "))
  (initget 7)
  (setq fw (getreal "\nFooting WIDTH [in]: "))
  (initget 7)
  (setq fd (getreal "\nFooting DEPTH [in]: "))

  (initget 6)
  (setq cov (cond ((getreal "\nClear rebar COVER [in] <3.0>: ")) (3.0)))

  (initget "3 4 5 6 7 8")
  (setq bar (cond ((getkword "\nBar size [3/4/5/6/7/8] <4>: ")) ("4")))
  (setq bd     (/ (atof bar) 8.0)
        barlbl (strcat "#" bar))

  (initget 6)
  (setq gradeExp (cond ((getreal "\nStem EXPOSED above finish grade [in] <6.0>: ")) (6.0)))

  (initget 6)
  (setq txtH (cond ((getreal "\nText height [in] <3.0>: ")) (3.0)))

  ;; Sanity check
  (if (< sw (+ (* 2.0 cov) (* 3.0 bd)))
    (princ "\nWARNING: stem width may be too small for specified cover + bar size."))
  (if (< fd (+ (* 2.0 cov) bd))
    (princ "\nWARNING: footing depth may be too small for specified cover + bar size."))

  ;; --- Derived geometry --------------------------------------------
  (setq xL       (- (car ip) (/ sw 2.0))
        xR       (+ (car ip) (/ sw 2.0))
        fxL      (- (car ip) (/ fw 2.0))
        fxR      (+ (car ip) (/ fw 2.0))
        yFBot    (cadr ip)
        yFTop    (+ (cadr ip) fd)
        yT       (+ yFTop sh)
        gradeY   (- yT gradeExp)
        hookLen  (* 12.0 bd)               ; 12*db = std 90-deg hook ext.
        earthExt (max fw 24.0)
        dimOff   (max (* (max fw sh) 0.35) (* txtH 6.0))
        noteX    (+ fxR earthExt (* dimOff 0.8)))

  ;; --- Concrete outline (closed pline on S-CONC) -------------------
  (setvar "CLAYER" "S-CONC")
  (command "_.PLINE"
    (list fxL yFBot) (list fxR yFBot)
    (list fxR yFTop) (list xR  yFTop)
    (list xR  yT)    (list xL  yT)
    (list xL  yFTop) (list fxL yFTop)
    "_C")
  (setq concEnt (entlast))

  ;; --- Concrete hatch ----------------------------------------------
  (setvar "CLAYER" "S-HATCH")
  (command "_.-HATCH" "_P" "ANSI31" 6.0 0 "_S" concEnt "" "")

  ;; --- Earth regions (closed plines, then hatched with EARTH) ------
  (setvar "CLAYER" "S-EARTH")
  ;; LEFT
  (command "_.PLINE"
    (list (- fxL earthExt) gradeY)
    (list xL  gradeY)
    (list xL  yFTop)
    (list fxL yFTop)
    (list fxL yFBot)
    (list (- fxL earthExt) yFBot)
    "_C")
  (setq earthL (entlast))
  (command "_.-HATCH" "_P" "EARTH" 8.0 0 "_S" earthL "" "")
  ;; RIGHT
  (command "_.PLINE"
    (list xR  gradeY)
    (list (+ fxR earthExt) gradeY)
    (list (+ fxR earthExt) yFBot)
    (list fxR yFBot)
    (list fxR yFTop)
    (list xR  yFTop)
    "_C")
  (setq earthR (entlast))
  (command "_.-HATCH" "_P" "EARTH" 8.0 0 "_S" earthR "" "")

  ;; --- Finish grade lines (over the earth hatch top edge) ----------
  (setvar "CLAYER" "S-GRADE")
  (command "_.LINE" (list (- fxL earthExt) gradeY) (list xL gradeY) "")
  (command "_.LINE" (list xR gradeY) (list (+ fxR earthExt) gradeY) "")

  ;; --- Horizontal rebar (cross-section dots) -----------------------
  (setvar "CLAYER" "S-REBAR")
  (setq ftgL  (list (+ fxL cov (/ bd 2.0)) (+ yFBot cov (/ bd 2.0)))
        ftgR  (list (- fxR cov (/ bd 2.0)) (+ yFBot cov (/ bd 2.0)))
        stmTL (list (+ xL  cov (/ bd 2.0)) (- yT    cov (/ bd 2.0)))
        stmTR (list (- xR  cov (/ bd 2.0)) (- yT    cov (/ bd 2.0)))
        stmML (list (+ xL  cov (/ bd 2.0)) (+ yFTop (/ sh 2.0)))
        stmMR (list (- xR  cov (/ bd 2.0)) (+ yFTop (/ sh 2.0))))
  (foreach p (list ftgL ftgR stmTL stmTR stmML stmMR)
    (stf:dot p bd))

  ;; --- Vertical dowels with 90-deg std hooks (left & right) --------
  (setq dwlLx (+ xL cov (/ bd 2.0))
        dwlRx (- xR cov (/ bd 2.0))
        dwlBy (+ yFBot cov (/ bd 2.0))
        dwlTy (- yT    cov (/ bd 2.0)))
  (command "_.PLINE"
    (list (+ dwlLx hookLen) dwlBy)
    (list dwlLx dwlBy)
    (list dwlLx dwlTy) "")
  (command "_.PLINE"
    (list (- dwlRx hookLen) dwlBy)
    (list dwlRx dwlBy)
    (list dwlRx dwlTy) "")

  ;; --- Dimensions --------------------------------------------------
  (setvar "CLAYER" "S-DIM")
  (setvar "DIMSCALE" (max 1.0 (/ txtH 0.18)))
  ;; Footing width (below)
  (command "_.DIMLINEAR" (list fxL yFBot) (list fxR yFBot)
    (list (car ip) (- yFBot dimOff)))
  ;; Footing depth (right of footing, between footing edge and earth)
  (command "_.DIMLINEAR" (list fxR yFBot) (list fxR yFTop)
    (list (+ fxR (* dimOff 0.4)) (+ yFBot (/ fd 2.0))))
  ;; Stem width (above)
  (command "_.DIMLINEAR" (list xL yT) (list xR yT)
    (list (car ip) (+ yT (* dimOff 0.4))))
  ;; Stem height (left side of stem)
  (command "_.DIMLINEAR" (list xL yFTop) (list xL yT)
    (list (- xL (* dimOff 0.4)) (+ yFTop (/ sh 2.0))))
  ;; Total height (far left, outside earth)
  (command "_.DIMLINEAR" (list fxL yFBot) (list fxL yT)
    (list (- fxL earthExt dimOff) (+ yFBot (/ (+ fd sh) 2.0))))

  ;; --- Keynotes / leader text --------------------------------------
  (setvar "CLAYER" "S-TEXT")
  ;; Top stem horizontal bars
  (stf:note stmTR (list noteX (+ yT (* dimOff 0.6)))
    (strcat "(2) " barlbl " CONT. HORIZ., TOP") txtH)
  ;; Mid stem horizontal bars
  (stf:note stmMR (list noteX (cadr stmMR))
    (strcat "(2) " barlbl " CONT. HORIZ., MID") txtH)
  ;; Vertical dowels
  (stf:note (list dwlRx (+ yFTop (* sh 0.7)))
            (list noteX (+ yT (* dimOff 1.4)))
    (strcat barlbl " VERT. DOWELS @ 24\" O.C. W/ STD. 90-DEG. HOOK") txtH)
  ;; Footing bottom horizontal bars
  (stf:note ftgR (list noteX (- yFBot dimOff (* txtH 2.0)))
    (strcat "(2) " barlbl " CONT. HORIZ., BOTTOM") txtH)
  ;; Clear cover note (inside footing, centered)
  (command "_.TEXT" "_J" "_MC"
    (list (car ip) (+ yFBot (* fd 0.35)))
    txtH 0 (strcat (rtos cov 2 2) "\" CLR. (TYP.)"))
  ;; Finish grade label (right side, just past earth hatch)
  (command "_.TEXT"
    (list (+ fxR earthExt (* txtH 0.5)) (+ gradeY (* txtH 0.3)))
    txtH 0 "FINISH GRADE")
  ;; Stem wall label
  (command "_.TEXT" "_J" "_MC"
    (list (car ip) (+ yFTop (* sh 0.78)))
    txtH 0 "STEM WALL")
  ;; Footing label
  (command "_.TEXT" "_J" "_MC"
    (list (car ip) (+ yFBot (* fd 0.72)))
    txtH 0 "CONT. FOOTING")

  ;; --- Restore -----------------------------------------------------
  (setvar "CMDECHO"  *stf-oldecho*)
  (setvar "OSMODE"   *stf-oldos*)
  (setvar "CLAYER"   *stf-oldlyr*)
  (setvar "DIMSCALE" *stf-olddsc*)
  (setq *error* *stf-olderr*)
  (princ (strcat "\nSTEMFTG complete:"
                 "\n  Stem    " (rtos sw 2 2) "\" wide x " (rtos sh 2 2) "\" tall"
                 "\n  Footing " (rtos fw 2 2) "\" wide x " (rtos fd 2 2) "\" deep"
                 "\n  Rebar   " barlbl " @ " (rtos cov 2 2) "\" clear cover"))
  (princ))

(princ "\nSTEMFTG.LSP loaded.  Type STEMFTG to run.")
(princ)
