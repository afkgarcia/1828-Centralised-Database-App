package app.export

import app.data.PhaseData
import app.model.Task
import app.model.TaskStatus
import app.state.AppState
import org.apache.poi.ss.usermodel.IndexedColors
import org.apache.poi.ss.util.WorkbookUtil
import org.apache.poi.xssf.usermodel.XSSFCellStyle
import org.apache.poi.xssf.usermodel.XSSFWorkbook
import java.io.File
import java.io.FileOutputStream
import java.time.LocalDate

object ExcelExport {
    private const val HEADER_FONT_BOLD = true

    fun write(target: File) {
        val wb = XSSFWorkbook()
        val headerStyle = headerStyle(wb)

        // Overview sheet
        val intro = wb.createSheet("Overview")
        intro.createRow(0).createCell(0).setCellValue("Fasedocument Tracker — Export")
        intro.createRow(2).createCell(0).setCellValue("Export: ${LocalDate.now()}")
        intro.createRow(3).createCell(0).setCellValue("Steden: " + AppState.cityOrder.joinToString(", "))
        intro.createRow(4).createCell(0).setCellValue("Projecten: " + AppState.projectOrder.joinToString(", "))

        // One sheet per city
        AppState.cityOrder.forEach { name ->
            val sheetName = WorkbookUtil.createSafeSheetName("City_$name").take(31)
            val sheet = wb.createSheet(sheetName)
            var r = 0
            sheet.createRow(r++).createCell(0).setCellValue("City: $name")
            r++
            writeHeaderRow(sheet, r++, headerStyle)
            AppState.cities[name]!!.tasks.forEach { writeTaskRow(sheet, r++, it) }
            applyColumnWidths(sheet)
        }

        // One sheet per project phase
        AppState.projectOrder.forEach { pname ->
            val proj = AppState.projects[pname]!!
            proj.phases.forEachIndexed { pi, phase ->
                val phaseTitle = PhaseData.projectPhases[pi].sheet
                val rawName = "${pname.take(10)}_P${pi + 1}_$phaseTitle"
                val sheetName = WorkbookUtil.createSafeSheetName(rawName).take(31)
                val sheet = wb.createSheet(sheetName)
                var r = 0
                sheet.createRow(r++).createCell(0).setCellValue("Project: $pname")
                sheet.createRow(r++).createCell(0).setCellValue("Phase ${pi + 1}: $phaseTitle")
                val statusStr = when {
                    phase.approved -> "Approved"
                    phase.submitted -> "Submitted"
                    else -> "In progress"
                }
                sheet.createRow(r++).createCell(0).setCellValue("Phase status: $statusStr")
                r++
                writeHeaderRow(sheet, r++, headerStyle)
                phase.tasks.forEach { writeTaskRow(sheet, r++, it) }
                applyColumnWidths(sheet)
            }
        }

        FileOutputStream(target).use { wb.write(it) }
        wb.close()
    }

    private val headerCols = listOf(
        "Step", "Blok", "Deliverable", "Status", "Documents",
        "R", "A", "S", "C", "I", "Custom",
    )

    private fun writeHeaderRow(sheet: org.apache.poi.ss.usermodel.Sheet, rowIdx: Int, style: XSSFCellStyle) {
        val row = sheet.createRow(rowIdx)
        headerCols.forEachIndexed { i, label ->
            val cell = row.createCell(i)
            cell.setCellValue(label)
            cell.cellStyle = style
        }
    }

    private fun writeTaskRow(sheet: org.apache.poi.ss.usermodel.Sheet, rowIdx: Int, t: Task) {
        val row = sheet.createRow(rowIdx)
        row.createCell(0).setCellValue(t.step)
        row.createCell(1).setCellValue(t.blok)
        row.createCell(2).setCellValue(t.deliverable)
        row.createCell(3).setCellValue(statusLabel(t.status))
        row.createCell(4).setCellValue(t.attachments.joinToString("; ") { "${it.name} — ${it.url}" })
        row.createCell(5).setCellValue(t.r)
        row.createCell(6).setCellValue(t.a)
        row.createCell(7).setCellValue(t.s)
        row.createCell(8).setCellValue(t.c)
        row.createCell(9).setCellValue(t.iCol)
        row.createCell(10).setCellValue(if (t.custom) "yes" else "")
    }

    private fun statusLabel(s: TaskStatus): String = when (s) {
        TaskStatus.DONE -> "Klaar / Done"
        TaskStatus.NA -> "N.v.t. / N/A"
        TaskStatus.OPEN -> "Open"
    }

    private fun applyColumnWidths(sheet: org.apache.poi.ss.usermodel.Sheet) {
        val widths = listOf(8, 32, 46, 14, 36, 6, 6, 6, 6, 6, 8)
        widths.forEachIndexed { i, w -> sheet.setColumnWidth(i, w * 256) }
    }

    private fun headerStyle(wb: XSSFWorkbook): XSSFCellStyle {
        val style = wb.createCellStyle()
        val font = wb.createFont()
        font.bold = HEADER_FONT_BOLD
        font.color = IndexedColors.WHITE.index
        style.setFont(font)
        style.fillForegroundColor = IndexedColors.DARK_BLUE.index
        style.fillPattern = org.apache.poi.ss.usermodel.FillPatternType.SOLID_FOREGROUND
        return style
    }
}
