# The hardware: what is known and where it comes from

Read from Waveshare's published material on 2026-11-16 (its product page, wiki, schematic and the dimension drawings and photos on the product page), or from this repository. None of Waveshare's pictures are kept here; the page in `hardware/` is drawn from these facts, and corrections found while measuring for it are folded in.

## The product

- Waveshare ESP32-S3-LCD-1.3 (also sold by SpotPear). Variants: the bare board (with two black pin headers, loose); -B "with plastic case"; -C "with plastic case and prism cube" (package: the -C and "Prism cube x1"). desk-sage uses the -C. Product page: https://www.waveshare.com/esp32-s3-lcd-1.3.htm ; wiki: https://www.waveshare.com/wiki/ESP32-S3-LCD-1.3 ; schematic: https://files.waveshare.com/wiki/ESP32-S3-LCD-1.3/ESP32S3_1.3inch.pdf (drawn 2025-03-19).
- firmware/platformio.ini: "SpotPear/Waveshare ESP32-S3-LCD-1.3 (prism); ESP32-S3R8, 16MB flash, 8MB octal PSRAM, ST7789 240x240, CH343 USB-serial". firmware/src/main.cpp: QMI8658 on I2C SDA 47 / SCL 48; the LCD on SPI at 80 MHz; the image is drawn mirrored for the prism (rotation 4).

## Dimensions (mm), from Waveshare's dimension drawings on the product page

- Board (PCB with the display): PCB 26.25 wide by 29.22 tall. Four M2 holes with brass standoffs, 22.55 apart across and 25.44 apart vertically. The two header rows are 23.72 apart; header pitch 2.54; the lowest header pin is 5.62 above the board's bottom edge. Whole board 11.40 thick, standoffs included (side view: the display, its metal back, the PCB, the standoffs on the far side).
- Display module: 23.40 by 23.40, with a black strip along one edge (the panel's bonded edge with its flex cable).
- -B case (holds the board): 28.65 by 31.75, 12.55 deep; its front frame 0.45 proud at the edges; a USB-C opening on one side (the product photos).
- -C stand: 50.55 deep by 33.10 wide by 36.90 tall, black, its sides sloping, an opening at the front and a cutout at the back (the product photos). One photo shows a brass standoff through the stand's open back, which suggests the stand may hold the board without the -B case: not published. The boxed board sits in it face up; the prism cube stands on the display.
- Prism cube: 25.40 by 25.40 by 25.50. The photos show a diagonal plane inside it (two right-angle prisms meeting on a diagonal). Its coating is not published.
- desk-sage's own measurement of the stock -C case (enclosure/lump_monitor_mount.scad, by the engine's author): case 33.4 wide, 50.1 deep, 37.2 tall; cube 25.6; the cube's front face 12.2 behind the case's front edge.

## What is on the board

From the schematic's blocks: IMU, VBAT_ADC, RST, FLASH, RST_Control, BAT, POWER, LCD, GPIO_OUT, RGB, M2 3.5*5+1.2 (the standoffs: M2, 3.5 diameter, 5 long, 1.2 thread), ESP32S3-R8, TYPE-C, Download Circuit, Micro-SD, Switching of Power.

Parts named in the schematic: ESP32-S3R8 (the processor, 8 MB PSRAM in its package), W25Q128 (16 MB SPI flash; the photo shows "winbond 25Q128JVSQ", an 8-pin SOIC), X1 40 MHz crystal, ANT1 (ceramic antenna; a 2.0 nH matching part), CH343P (USB to serial), Type_C1 (USB-C receptacle, CC resistors 5.1K), ME6217C33M5G (3.3 V regulator, 800 mA, SOT-23-5), PL4054 (Li-ion charger; the schematic text reads "L4054"), DMG2305UX (P-channel MOSFET, in the power switching), BCM857BS (dual PNP), MMBT3904 (NPN transistors: the download circuit's auto reset, the backlight), QMI8658A (6-axis IMU), WS2812B (RGB LED), TF1 (microSD slot), TFT1 (the display's connection, LEDA/LEDK its backlight), BAT1 (MX1.25 battery header, 3.7 V Li-ion, battery not included), the 2.54 mm GPIO header holes (two rows of 8: 5V, GND, 3V3, IO1 to IO5 on one side; IO7 to IO14 on the other), a charge LED ("off when fully charged"). No buttons are listed on the product page.

Positions, from Waveshare's numbered photo of the component side (the side away from the display), scaled by the M2 holes:
1. ESP32-S3R8: centre, slightly below the middle (a 7 by 7 QFN).
2. Ceramic antenna: at the bottom edge, centre (a red chip marked "C3").
3. 16 MB flash: right of the processor, lower right (SOIC-8).
4. TF card slot: above the processor, centre (a metal push slot).
5. Charge LED: top right corner, by the label "Charge".
6. PL4054: right of the TF slot, upper right.
7. ME6217C33M5G: left of the TF slot, left middle.
8. MX1.25 battery header: top edge, centre (white, two pins, "- +").
9. The header holes: two columns along the left and right edges.
Also visible: a SOT-363 (likely the BCM857BS), a SOT-23 and an 8-pin part marked "21357" at the top left (not identified), the 40 MHz crystal at the lower left (about 2.5 by 2.0 mm, a 2520 package), five 0603 passives, and the four brass standoffs at the corners.
- The QMI8658 is "on the back side" per Waveshare, which, relative to this photo, is the display side. The CH343P, the WS2812B and the USB-C are not in this photo, so they are on the display side too; their exact positions there are not published. The USB-C opens on one edge, between the display and the PCB (the side views); four plated slots on the component side match a USB-C shell's legs, which centres it on the top edge. A product photo shows a cable plugged into that edge and a red glow beside it.

## Repository

- enclosure/lump_monitor_mount.scad: the engine author's printable monitor mount that holds the stock -C case (plate, tilting arm, swivelling cradle, printed thumbscrews). desk-sage may show it as an accessory.
